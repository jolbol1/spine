import { env } from "@/env"
import { errorMessage, serverLogger } from "@/server/log"

const log = serverLogger("scrape")

export const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

export type PageFetch =
  | { ok: true; html: string; via: "direct" | "firecrawl" }
  | { ok: false; status: "notfound" | "blocked" | "unreachable" }

/**
 * Fetch a page with a realistic browser UA, falling back to Firecrawl when
 * the site blocks the request — several sources (Letterboxd, sometimes
 * Rotten Tomatoes) refuse datacenter IPs outright, so a direct fetch that
 * works from a home connection 403s from most hosting.
 * `preferFirecrawl` skips the doomed direct attempt on subsequent pages.
 */
export async function fetchPageWithFallback(
  url: string,
  preferFirecrawl = false
): Promise<PageFetch> {
  if (!preferFirecrawl) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": BROWSER_UA,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9",
          "Accept-Language": "en-GB,en;q=0.9",
        },
        signal: AbortSignal.timeout(15_000),
      })
      if (res.ok) return { ok: true, html: await res.text(), via: "direct" }
      if (res.status === 404) return { ok: false, status: "notfound" }
      // 403/429/5xx — fall through to Firecrawl.
      log.warn("direct fetch blocked, trying Firecrawl", {
        url,
        status: res.status,
      })
    } catch (err) {
      // Network failure — fall through to Firecrawl.
      log.warn("direct fetch failed, trying Firecrawl", {
        url,
        error: errorMessage(err),
      })
    }
  }

  if (!env.FIRECRAWL_API_KEY) {
    log.warn("no FIRECRAWL_API_KEY — giving up on blocked page", { url })
    return { ok: false, status: "blocked" }
  }
  try {
    const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.FIRECRAWL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url, formats: ["rawHtml"] }),
      signal: AbortSignal.timeout(90_000),
    })
    const payload = (await res.json()) as {
      data?: { rawHtml?: string; metadata?: { statusCode?: number } }
    }
    if (payload.data?.metadata?.statusCode === 404) {
      return { ok: false, status: "notfound" }
    }
    if (!res.ok || !payload.data?.rawHtml) {
      log.warn("Firecrawl scrape failed", { url, status: res.status })
      return { ok: false, status: "blocked" }
    }
    return { ok: true, html: payload.data.rawHtml, via: "firecrawl" }
  } catch (err) {
    log.error("Firecrawl unreachable", { url, error: errorMessage(err) })
    return { ok: false, status: "unreachable" }
  }
}
