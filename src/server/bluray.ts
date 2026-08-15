import { createServerFn } from "@tanstack/react-start"
import { z } from "zod"
import { env } from "@/env"
import { errorMessage, serverLogger } from "@/server/log"
import { authMiddleware } from "@/server/middleware"
import {
  ACCEPT_LANGUAGE,
  BROWSER_UA,
  defaultTransport,
  fetchPage,
} from "@/server/page-fetch"
import type { PageTransport } from "@/server/page-fetch"

const log = serverLogger("bluray")

export interface BlurayResult {
  title: string
  year: number | null
  url: string
  coverUrl: string
  countryFlag: string | null
  releaseDate: string | null
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
}

interface BluraySearchResponse {
  items?: Array<{
    title?: string
    year?: string
    url?: string
    cover?: string
    flag?: string
    reldate?: string
  }>
}

/** Convert the quicksearch wire response into the app's stable result shape. */
export function parseBluraySearchResponse(
  json: BluraySearchResponse
): BlurayResult[] {
  return (json.items ?? [])
    .filter((item) => item.title && item.url && item.cover)
    .slice(0, 24)
    .map((item) => ({
      title: decodeEntities(item.title!),
      year: item.year ? Number(item.year) || null : null,
      url: item.url!.replace("://m.blu-ray.com", "://www.blu-ray.com"),
      coverUrl: item.cover!.replace("_small.jpg", "_front.jpg"),
      countryFlag: item.flag ?? null,
      releaseDate: item.reldate ?? null,
    }))
}

/**
 * Search blu-ray.com's quicksearch API (also matches UPC barcodes).
 * Small covers are upgraded to the full-size `_front.jpg` variant.
 */
export const searchBlurayFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(z.object({ query: z.string().trim().min(1).max(200) }))
  .handler(async ({ data }): Promise<BlurayResult[]> => {
    const url = new URL("https://m.blu-ray.com/quicksearch/search.php")
    url.searchParams.set("section", "bluraymovies")
    url.searchParams.set("country", "all")
    url.searchParams.set("keyword", data.query)

    let json: BluraySearchResponse
    try {
      const res = await fetch(url, {
        // Quicksearch answers JSON rather than a page, so it does not go
        // through the port — but the site demands the language header here
        // too. See ACCEPT_LANGUAGE.
        headers: {
          "User-Agent": BROWSER_UA,
          "Accept-Language": ACCEPT_LANGUAGE,
        },
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) {
        log.warn("quicksearch failed", {
          query: data.query,
          status: res.status,
        })
        return []
      }
      json = await res.json()
    } catch (err) {
      log.error("quicksearch unreachable", {
        query: data.query,
        error: errorMessage(err),
      })
      return []
    }

    const results = parseBluraySearchResponse(json)
    log.info("quicksearch", { query: data.query, results: results.length })
    return results
  })

// ---------------------------------------------------------------------------
// Full import from a blu-ray.com product page
// ---------------------------------------------------------------------------

export interface BlurayImport {
  title: string
  year: number | null
  director: string | null
  format: "4K UHD" | "Blu-ray" | "DVD"
  audio: string | null
  hdr: string | null
  region: string | null
  label: string | null
  spineNumber: number | null
  runtimeMinutes: number | null
  discCount: number
  coverUrl: string | null
  url: string
}

const DISC_WORDS: Record<string, number> = {
  single: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
}

/** Parse the stable metadata fields from a Blu-ray.com product-page fixture. */
export function parseBlurayProductHtml(
  html: string,
  parsed: URL
): BlurayImport {
  const first = (re: RegExp): string | null => {
    const match = html.match(re)
    return match ? match[1].trim() : null
  }

  const rawTitle = first(/<title>([^<]+)<\/title>/) ?? ""
  const title = decodeEntities(rawTitle)
    .replace(/\s+(4K\s+)?(Blu-ray|DVD).*$/i, "")
    .replace(/\s*\([^)]*\)\s*$/, "")
    .trim()

  const resolution = first(/Resolution:\s*([^<]+)/)
  const is4k =
    /4K Blu-ray/i.test(rawTitle) || (resolution?.includes("2160") ?? false)
  const isDvd = /\/dvd\//.test(parsed.pathname) || /\bDVD\b/.test(rawTitle)
  const format = is4k
    ? ("4K UHD" as const)
    : isDvd
      ? ("DVD" as const)
      : ("Blu-ray" as const)

  const year = first(/movies\.php\?year=(\d{4})/)
  const runtime = first(/>(\d+)\s+min</)
  const director = first(/Director:\s*<a[^>]*>([^<]+)<\/a>/)
  const label = first(/movies\.php\?studioid=\d+[^>]*>([^<]+)</)
  const audioBlock = first(/<div id="shortaudio">\s*([^<]+)/)
  const audioLine =
    audioBlock && !/^TBA$/i.test(audioBlock)
      ? audioBlock.split("\n")[0].trim()
      : null
  const hdrLine = first(/HDR:?\s*(Dolby Vision[^<]*|HDR10\+?[^<]*)/)
  const region = first(/Region\s+([A-C](?:,\s*[A-C])*|Free)\b/)
  const spine = first(/Spine\s*#?\s*(\d+)/i)
  const cover = first(/property="og:image" content="([^"]+)"/)

  let discCount = 1
  const discWord = first(
    /\b(Single|Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten)-disc\b/i
  )
  if (discWord) discCount = DISC_WORDS[discWord.toLowerCase()] ?? 1

  return {
    title: title || decodeEntities(rawTitle),
    year: year ? Number(year) : null,
    director: director ? decodeEntities(director) : null,
    format,
    audio: audioLine ? decodeEntities(audioLine).trim() : null,
    hdr: hdrLine ? decodeEntities(hdrLine).trim() : null,
    region: region ?? null,
    label: label ? decodeEntities(label) : null,
    spineNumber: spine ? Number(spine) : null,
    runtimeMinutes: runtime ? Number(runtime) : null,
    discCount,
    coverUrl: cover?.replace("_large.jpg", "_front.jpg") ?? null,
    url: parsed.toString(),
  }
}

export type BlurayImportResult =
  { success: true; data: BlurayImport } | { success: false; error: string }

/**
 * Blu-ray.com serves ISO-8859-1 and declares it in a meta tag some way into
 * the page, so the port is told what to read the bytes as when that label
 * does not survive the response.
 */
const BLURAY_CHARSET = "iso-8859-1"

/** A film the site does not have: sometimes a 404, sometimes a 200 saying so. */
const NO_SUCH_MOVIE_PATTERN = /No such movie/i

const NO_PAGE_ERROR =
  "Blu-ray.com has no page at that link — check the address on the site."

/**
 * Fetch a blu-ray.com product page and pull every field the add form needs:
 * title, year, director, format, audio, HDR, region, publisher, spine,
 * runtime, disc count, and full-size cover.
 *
 * Fetching goes through the outbound page-fetch port, so the import gets the
 * same Firecrawl fallback the other sources have when the site refuses us,
 * and the same character-set handling — accented titles come back intact.
 */
export async function importBlurayProduct(
  rawUrl: string,
  transport: PageTransport = defaultTransport
): Promise<BlurayImportResult> {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return { success: false, error: "That's not a valid URL." }
  }
  const host = parsed.hostname.replace(/^(www|m|forum)\./, "")
  if (host !== "blu-ray.com") {
    return {
      success: false,
      error: "Paste a blu-ray.com product link (blu-ray.com/movies/…).",
    }
  }
  parsed.hostname = "www.blu-ray.com"
  const url = parsed.toString()

  const page = await fetchPage(
    { url, defaultCharset: BLURAY_CHARSET },
    transport
  )
  if (!page.ok) {
    log.warn("product page not fetched", { url, status: page.status })
    if (page.status === "notfound")
      return { success: false, error: NO_PAGE_ERROR }
    if (page.status === "blocked") {
      return {
        success: false,
        error: env.FIRECRAWL_API_KEY
          ? "Blu-ray.com is blocking requests right now — try again in a few minutes."
          : "Blu-ray.com is blocking this server's requests. Set FIRECRAWL_API_KEY in .env so imports can route around it.",
      }
    }
    return { success: false, error: "Could not reach Blu-ray.com." }
  }

  const imported = parseBlurayProductHtml(page.html, parsed)
  if (!imported.title) {
    if (NO_SUCH_MOVIE_PATTERN.test(page.html)) {
      log.warn("no such movie", { url })
      return { success: false, error: NO_PAGE_ERROR }
    }
    log.error("product page had no parseable title", {
      url,
      via: page.via,
      charset: page.charset,
      bytes: page.html.length,
      bodyStart: page.html.slice(0, 120),
    })
    return {
      success: false,
      error:
        "Blu-ray.com sent back a page without any disc details — try again in a minute.",
    }
  }

  log.info("imported product page", {
    url,
    via: page.via,
    title: imported.title,
    format: imported.format,
  })
  return { success: true, data: imported }
}

export const importBlurayUrlFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ url: z.string().trim().min(1).max(2048) }))
  .handler(({ data }) => importBlurayProduct(data.url))
