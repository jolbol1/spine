import { createServerFn } from "@tanstack/react-start"
import { asc, eq } from "drizzle-orm"
import { z } from "zod"
import { films, wishlistItems, withUser } from "@/db"
import { env } from "@/env"
import { toSortTitle } from "@/lib/film-helpers"
import { authMiddleware } from "@/server/middleware"

// ---------------------------------------------------------------------------
// Retailer support
// ---------------------------------------------------------------------------

const ALLOWED_DOMAINS = [
  "hmv.com",
  "zavvi.com",
  "amazon.co.uk",
  "amazon.com",
  "arrowfilms.com",
  "arrowvideo.com",
  "criterion.com",
  "criterionstore.com",
  "indicatorseries.com",
  "powerhousefilms.co.uk",
  "eurekavideo.co.uk",
  "secondsightfilms.co.uk",
  "88films.tv",
  "bfi.org.uk",
  "terracottadistribution.com",
  "mundaymondaystudios.com",
  "vinegarsyndrome.com",
  "imprint-films.com.au",
  "imprintfilms.com.au",
  "kinolorber.com",
  "shoutfactory.com",
  "blu-ray.com",
]

function detectRetailer(url: string): string {
  const u = url.toLowerCase()
  if (u.includes("hmv.com")) return "HMV"
  if (u.includes("zavvi.com")) return "Zavvi"
  if (u.includes("amazon.co.uk") || u.includes("amazon.com")) return "Amazon"
  if (u.includes("arrowfilms.com") || u.includes("arrowvideo.com"))
    return "Arrow"
  if (u.includes("criterion.com") || u.includes("criterionstore"))
    return "Criterion"
  if (u.includes("indicatorseries") || u.includes("powerhousefilms.co.uk"))
    return "Indicator"
  if (u.includes("eurekavideo.co.uk")) return "Eureka"
  if (u.includes("secondsightfilms.co.uk")) return "Second Sight"
  if (u.includes("88films.tv")) return "88 Films"
  if (u.includes("shop.bfi.org.uk") || u.includes("bfi.org.uk/shop"))
    return "BFI"
  if (u.includes("terracottadistribution.com")) return "Terracotta"
  if (u.includes("mundaymondaystudios.com") || u.includes("mundaymonday"))
    return "Munday Monday"
  if (u.includes("vinegarsyndrome.com")) return "Vinegar Syndrome"
  if (u.includes("imprint-films.com.au") || u.includes("imprintfilms"))
    return "Imprint"
  if (u.includes("kinolorber.com")) return "Kino Lorber"
  if (u.includes("shoutfactory.com")) return "Shout Factory"
  if (u.includes("blu-ray.com")) return "Blu-ray.com"
  try {
    const hostname = new URL(url).hostname
      .replace("www.", "")
      .replace("shop.", "")
    const name = hostname.split(".")[0]
    return name.charAt(0).toUpperCase() + name.slice(1)
  } catch {
    return "Unknown"
  }
}

/** Find the product price, not promotional banner prices. */
function extractPrice(markdown: string, title: string): string | null {
  if (title) {
    const escapedTitle = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const afterTitlePattern = new RegExp(
      escapedTitle + "[\\s\\S]{0,200}?([£$€]\\d+[.,]\\d{2})",
      "i"
    )
    const afterTitleMatch = markdown.match(afterTitlePattern)
    if (afterTitleMatch) return afterTitleMatch[1]
  }

  const headingPriceMatch = markdown.match(
    /^#{1,3}\s+.+\n\n\s*([£$€]\d+[.,]\d{2})/m
  )
  if (headingPriceMatch) return headingPriceMatch[1]

  const decimalPriceMatch = markdown.match(/([£$€]\d+[.,]\d{2})/)
  if (decimalPriceMatch) return decimalPriceMatch[1]

  const anyPriceMatch = markdown.match(/([£$€]\d+(?:[.,]\d{2})?)/)
  if (anyPriceMatch) return anyPriceMatch[1]

  return null
}

// ---------------------------------------------------------------------------
// Scrape a retailer URL via Firecrawl
// ---------------------------------------------------------------------------

export const scrapeWishlistUrlFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ url: z.string().trim().min(1).max(2048) }))
  .handler(async ({ data }) => {
    let formattedUrl = data.url.trim()
    if (
      !formattedUrl.startsWith("http://") &&
      !formattedUrl.startsWith("https://")
    ) {
      formattedUrl = `https://${formattedUrl}`
    }

    let hostname: string
    try {
      const parsed = new URL(formattedUrl)
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        throw new Error("bad protocol")
      }
      hostname = parsed.hostname.replace(/^(www|shop)\./i, "")
    } catch {
      return { success: false as const, error: "Invalid URL format" }
    }

    if (
      !ALLOWED_DOMAINS.some((d) => hostname === d || hostname.endsWith("." + d))
    ) {
      return {
        success: false as const,
        error: "URL must be from a supported retailer",
      }
    }

    const retailer = detectRetailer(formattedUrl)

    if (!env.FIRECRAWL_API_KEY) {
      return {
        success: false as const,
        error:
          "Scraping is not configured — set FIRECRAWL_API_KEY in .env. You can still add the item manually.",
        retailer,
      }
    }

    let payload: {
      data?: { metadata?: Record<string, unknown>; markdown?: string }
      metadata?: Record<string, unknown>
      markdown?: string
      error?: string
    }
    try {
      const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.FIRECRAWL_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url: formattedUrl,
          formats: ["markdown"],
          onlyMainContent: true,
        }),
        signal: AbortSignal.timeout(45_000),
      })
      payload = await res.json()
      if (!res.ok) {
        return {
          success: false as const,
          error: payload.error ?? "Failed to scrape the page",
          retailer,
        }
      }
    } catch {
      return {
        success: false as const,
        error: "Scraping service unreachable",
        retailer,
      }
    }

    const metadata = payload.data?.metadata ?? payload.metadata ?? {}
    const markdown = payload.data?.markdown ?? payload.markdown ?? ""

    let title = String(metadata.ogTitle ?? metadata.title ?? "")
    title = title
      .replace(
        /\s*[-|–]\s*(HMV|Zavvi|Amazon\.co\.uk|Amazon\.com|Arrow|Criterion).*$/i,
        ""
      )
      .replace(/\s*\[.*?\]\s*$/, "")
      .trim()

    const price = extractPrice(markdown, title)
    const imageUrl = (metadata.ogImage ?? metadata.image ?? null) as
      string | null

    return {
      success: true as const,
      data: { title, price, retailer, imageUrl, url: formattedUrl },
    }
  })

// ---------------------------------------------------------------------------
// Wishlist CRUD
// ---------------------------------------------------------------------------

const wishlistInput = z.object({
  title: z.string().trim().min(1).max(500),
  director: z.string().trim().max(500).nullish(),
  year: z.number().int().min(1878).max(2100).nullish(),
  format: z.string().trim().max(50).nullish(),
  url: z.string().trim().max(2048).nullish(),
  retailer: z.string().trim().max(200).nullish(),
  price: z.string().trim().max(50).nullish(),
  coverUrl: z.string().trim().max(2048).nullish(),
  notes: z.string().trim().max(5000).nullish(),
})

export const listWishlistFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    return withUser(context.userId, (tx) =>
      tx.select().from(wishlistItems).orderBy(asc(wishlistItems.createdAt))
    )
  })

export const createWishlistItemFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(wishlistInput)
  .handler(async ({ context, data }) => {
    const rows = await withUser(context.userId, (tx) =>
      tx
        .insert(wishlistItems)
        .values({
          userId: context.userId,
          title: data.title,
          director: data.director || null,
          year: data.year ?? null,
          format: data.format || null,
          url: data.url || null,
          retailer: data.retailer || null,
          price: data.price || null,
          coverUrl: data.coverUrl || null,
          notes: data.notes || null,
        })
        .returning()
    )
    return rows[0]
  })

export const deleteWishlistItemFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ context, data }) => {
    await withUser(context.userId, (tx) =>
      tx.delete(wishlistItems).where(eq(wishlistItems.id, data.id))
    )
    return { ok: true }
  })

/** Bought it — move a wishlist item into the collection. */
export const moveToCollectionFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ context, data }) => {
    return withUser(context.userId, async (tx) => {
      const rows = await tx
        .select()
        .from(wishlistItems)
        .where(eq(wishlistItems.id, data.id))
        .limit(1)
      const item = rows.at(0)
      if (!item) return null

      const inserted = await tx
        .insert(films)
        .values({
          userId: context.userId,
          title: item.title,
          sortTitle: toSortTitle(item.title),
          director: item.director,
          year: item.year,
          format: item.format ?? "Blu-ray",
          coverUrl: item.coverUrl,
          notes: item.notes,
        })
        .returning()
      await tx.delete(wishlistItems).where(eq(wishlistItems.id, data.id))
      return inserted[0]
    })
  })
