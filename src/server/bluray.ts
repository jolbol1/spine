import { createServerFn } from "@tanstack/react-start"
import { z } from "zod"
import { errorMessage, serverLogger } from "@/server/log"
import { authMiddleware } from "@/server/middleware"

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
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
          // Blu-ray.com rejects requests without an Accept-Language header
          // (200 + "error42" body). Node's fetch sends one by default; Bun's
          // — the production runtime — does not.
          "Accept-Language": "en-GB,en;q=0.9",
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

/**
 * Fetch a blu-ray.com product page and pull every field the add form needs:
 * title, year, director, format, audio, HDR, region, publisher, spine,
 * runtime, disc count, and full-size cover.
 */
export const importBlurayUrlFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ url: z.string().trim().min(1).max(2048) }))
  .handler(async ({ data }) => {
    let parsed: URL
    try {
      parsed = new URL(data.url)
    } catch {
      return { success: false as const, error: "That's not a valid URL." }
    }
    const host = parsed.hostname.replace(/^(www|m|forum)\./, "")
    if (host !== "blu-ray.com") {
      return {
        success: false as const,
        error: "Paste a blu-ray.com product link (blu-ray.com/movies/…).",
      }
    }
    parsed.hostname = "www.blu-ray.com"

    let html: string
    try {
      const res = await fetch(parsed, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
          Accept: "text/html",
          // Required — see searchBlurayFn. Without it Blu-ray.com answers
          // 200 + "error42" and the import came back with an empty title.
          "Accept-Language": "en-GB,en;q=0.9",
        },
        signal: AbortSignal.timeout(15_000),
      })
      if (!res.ok) {
        log.warn("product page fetch failed", {
          url: parsed.toString(),
          status: res.status,
        })
        return {
          success: false as const,
          error: `Blu-ray.com returned ${res.status} for that link.`,
        }
      }
      // Blu-ray.com serves ISO-8859-1; fetch's .text() would assume UTF-8
      // and mangle accented names. Sniff the meta charset and decode right.
      const bytes = await res.arrayBuffer()
      const sniff = new TextDecoder("latin1").decode(bytes.slice(0, 2048))
      const charset = sniff.match(/charset=["']?([\w-]+)/i)?.[1] ?? "iso-8859-1"
      html = new TextDecoder(charset).decode(bytes)
    } catch (err) {
      log.error("product page unreachable", {
        url: parsed.toString(),
        error: errorMessage(err),
      })
      return { success: false as const, error: "Could not reach Blu-ray.com." }
    }

    const imported = parseBlurayProductHtml(html, parsed)
    if (!imported.title) {
      log.error("product page had no parseable title", {
        url: parsed.toString(),
        bytes: html.length,
        bodyStart: html.slice(0, 120),
      })
      return {
        success: false as const,
        error:
          "Blu-ray.com sent back a page without any disc details — try again in a minute.",
      }
    }

    log.info("imported product page", {
      url: parsed.toString(),
      title: imported.title,
      format: imported.format,
    })
    return { success: true as const, data: imported }
  })
