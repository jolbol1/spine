import { createServerFn } from "@tanstack/react-start"
import { z } from "zod"
import { env } from "@/env"
import { dedupeTmdbTitleMatches } from "@/lib/tmdb-title-matches"
import { authMiddleware } from "@/server/middleware"
import { searchTmdbTitles } from "@/server/tmdb"
import type { TmdbTitleMatch } from "@/server/tmdb"

/**
 * Reduce a shop/search-result page title to a plausible film title.
 * "Shrek [UK Import] von Andrew Adamson - DVD" → "Shrek"
 */
function cleanWebTitle(raw: string): string {
  let title = raw.split(/[|–—•]/)[0]
  for (const sep of [" - ", " – ", " by ", " von ", " de ", ": Amazon"]) {
    const i = title.indexOf(sep)
    if (i > 2) title = title.slice(0, i)
  }
  return title
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(
      /\b(DVD|Blu-?ray|4K|UHD|VHS|Widescreen|Full ?Screen|Special Edition|New|Sealed|Movie|Film|Import)\b/gi,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * Last-resort barcode lookup: web-search the number, distil the candidate
 * titles the shops agree on, and return canonical TMDB matches to pick from.
 */
export const searchWebBarcodeFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ barcode: z.string().trim().min(5).max(20) }))
  .handler(async ({ data }) => {
    if (!env.FIRECRAWL_API_KEY) {
      return {
        success: false as const,
        error: "Web search needs FIRECRAWL_API_KEY in .env.",
      }
    }

    let results: Array<{ title?: string }>
    try {
      const res = await fetch("https://api.firecrawl.dev/v1/search", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.FIRECRAWL_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: data.barcode, limit: 8 }),
        signal: AbortSignal.timeout(60_000),
      })
      const payload = (await res.json()) as {
        data?: Array<{ title?: string }>
        error?: string
      }
      if (!res.ok) {
        return {
          success: false as const,
          error: payload.error ?? "Web search failed.",
        }
      }
      results = payload.data ?? []
    } catch {
      return { success: false as const, error: "Web search unreachable." }
    }

    // Rank candidate titles by how many results agree on them.
    const counts = new Map<string, { title: string; n: number }>()
    for (const result of results) {
      if (!result.title) continue
      const cleaned = cleanWebTitle(result.title)
      if (cleaned.length < 2 || /^\d+$/.test(cleaned)) continue
      const key = cleaned.toLowerCase()
      const entry = counts.get(key)
      if (entry) entry.n++
      else counts.set(key, { title: cleaned, n: 1 })
    }
    const candidates = [...counts.values()]
      .sort((a, b) => b.n - a.n)
      .slice(0, 3)
      .map((c) => c.title)

    if (candidates.length === 0) {
      return {
        success: false as const,
        error: "The web search didn't surface a usable title.",
      }
    }

    // Canonicalise via TMDB, deduped across candidates.
    let matches: TmdbTitleMatch[] = []
    for (const candidate of candidates) {
      matches = dedupeTmdbTitleMatches([
        ...matches,
        ...(await searchTmdbTitles(candidate, 4)),
      ])
      if (matches.length >= 8) break
    }

    return { success: true as const, candidates, matches: matches.slice(0, 8) }
  })
