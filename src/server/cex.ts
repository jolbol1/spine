import { createServerFn } from "@tanstack/react-start"
import { z } from "zod"
import { authMiddleware } from "@/server/middleware"

export interface CexImport {
  title: string
  year: number | null
  format: "4K UHD" | "Blu-ray" | "DVD"
  runtimeMinutes: number | null
  label: string | null
  bbfcRating: string | null
  genres: string[]
  publisher: string | null
  supplier: string | null
  coverUrl: string | null
  barcode: string
}

interface CexAttribute {
  attributeName: string
  attributeValue: string[] | string
}

interface CexBox {
  boxName?: string
  categoryName?: string
  superCatName?: string
  imageUrls?: { large?: string | null }
  attributeInfo?: CexAttribute[] | null
}

/** "Simpsons Movie, The (PG)" → "The Simpsons Movie" */
function cleanCexTitle(name: string): string {
  let title = name.replace(/\s*\((U|PG|12A?|15|18|E|R18|TBC)\)\s*$/i, "").trim()
  const articleMatch = title.match(/^(.*),\s+(The|A|An)$/i)
  if (articleMatch) title = `${articleMatch[2]} ${articleMatch[1]}`
  return title
}

function attributeValue(box: CexBox, name: string): string | null {
  const attr = box.attributeInfo?.find((a) => a.attributeName === name)
  if (!attr) return null
  const value = Array.isArray(attr.attributeValue)
    ? attr.attributeValue.join(", ")
    : attr.attributeValue
  return value && value !== "Not Known" ? value : null
}

/**
 * Look a barcode up on CEX (uk.webuy.com) — good coverage of older DVDs
 * that Blu-ray.com doesn't list. Uses their public box-detail API.
 */
export const importCexFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ barcode: z.string().trim().min(5).max(20) }))
  .handler(async ({ data }) => {
    let box: CexBox | undefined
    try {
      const res = await fetch(
        `https://wss2.cex.uk.webuy.io/v3/boxes/${encodeURIComponent(data.barcode)}/detail`,
        {
          headers: { "User-Agent": "Mozilla/5.0 (Spine collection tracker)" },
          signal: AbortSignal.timeout(15_000),
        }
      )
      if (!res.ok) {
        return {
          success: false as const,
          error:
            res.status === 404
              ? "Not found on CEX either."
              : `CEX returned ${res.status}.`,
        }
      }
      const payload = (await res.json()) as {
        response?: { data?: { boxDetails?: CexBox[] } }
      }
      box = payload.response?.data?.boxDetails?.[0]
    } catch {
      return { success: false as const, error: "Could not reach CEX." }
    }

    if (!box?.boxName) {
      return { success: false as const, error: "Not found on CEX either." }
    }

    const category = `${box.superCatName ?? ""} ${box.categoryName ?? ""}`
    const format = /4k|uhd/i.test(category)
      ? ("4K UHD" as const)
      : /blu-?ray/i.test(category)
        ? ("Blu-ray" as const)
        : ("DVD" as const)

    const year = attributeValue(box, "year_of_production")
    const duration = attributeValue(box, "duration")
    const genre = attributeValue(box, "genre")
    const rawCover = box.imageUrls?.large ?? null

    return {
      success: true as const,
      data: {
        title: cleanCexTitle(box.boxName),
        year: year ? Number(year) || null : null,
        format,
        runtimeMinutes: duration ? Number(duration) || null : null,
        label: attributeValue(box, "imprint"),
        bbfcRating: attributeValue(box, "cert_uk"),
        genres: genre ? genre.split(", ") : [],
        publisher: attributeValue(box, "publisher"),
        supplier: attributeValue(box, "supplier"),
        coverUrl: rawCover ? encodeURI(rawCover) : null,
        barcode: data.barcode,
      } satisfies CexImport,
    }
  })
