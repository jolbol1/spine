import { createServerFn } from "@tanstack/react-start"
import { eq, isNull } from "drizzle-orm"
import { z } from "zod"
import { films, withUser } from "@/db"
import { toRtScoreUpdate } from "@/lib/rt-score-update"
import { authMiddleware } from "@/server/middleware"
import { fetchPageWithFallback } from "@/server/scrape"

/**
 * Rotten Tomatoes has no public API — scores are scraped from the site.
 * The search page renders <search-page-media-row> elements with the film
 * URL and release year; the film page embeds `criticsScore` / `audienceScore`
 * JSON blobs in its scripts. Both routes go through the shared
 * direct-then-Firecrawl fetcher used by the Letterboxd sync.
 */

export interface RtResult {
  url: string
  criticsScore: number | null
  audienceScore: number | null
}

const normTitle = (s: string) =>
  s
    .toLowerCase()
    .replace(/&/g, "and")
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()

const decodeEntities = (s: string) =>
  s
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")

interface SearchRow {
  url: string
  mediaType: "movie" | "tv"
  title: string
  year: number | null
}

function parseSearchRows(html: string): SearchRow[] {
  const rows: SearchRow[] = []
  const blocks = html.match(
    /<search-page-media-row[\s\S]*?<\/search-page-media-row>/g,
  )
  for (const block of blocks ?? []) {
    const anchor =
      /<a[^>]+href="(https:\/\/www\.rottentomatoes\.com\/(m|tv)\/[^"/]+)"[^>]*slot="title"[^>]*>([\s\S]*?)<\/a>/.exec(
        block,
      )
    if (!anchor) continue
    const year = /release-year="(\d{4})"/.exec(block)
    rows.push({
      url: anchor[1],
      mediaType: anchor[2] === "tv" ? "tv" : "movie",
      title: decodeEntities(anchor[3].trim()),
      year: year ? Number(year[1]) : null,
    })
  }
  return rows
}

/** Find the film's RT page URL via the site search. */
async function searchRtUrl(
  title: string,
  year: number | null,
  mediaType: "movie" | "tv" | null,
): Promise<string | null> {
  const page = await fetchPageWithFallback(
    `https://www.rottentomatoes.com/search?search=${encodeURIComponent(title)}`,
  )
  if (!page.ok) return null

  const want = normTitle(title)
  const rows = parseSearchRows(page.html).filter(
    (r) => mediaType == null || r.mediaType === mediaType,
  )
  const yearClose = (r: SearchRow) =>
    year != null && r.year != null && Math.abs(r.year - year) <= 1

  // Exact title + year beats exact title beats a year match alone.
  const exact = rows.filter((r) => normTitle(r.title) === want)
  const match =
    exact.find(yearClose) ??
    // RT lists US release years, which can drift a couple of years from
    // TMDB's — a lone exact-title hit is safe to take anyway. Multiple
    // hits (remakes) without a year match stay ambiguous.
    (exact.length === 1 ? exact[0] : undefined) ??
    // RT sometimes appends subtitles ("Title: Part One") — accept a
    // prefix match only when the year also agrees.
    rows.find((r) => normTitle(r.title).startsWith(want) && yearClose(r))
  return match?.url ?? null
}

/**
 * Pull a `"criticsScore":{…}` / `"audienceScore":{…}` object out of the
 * page's embedded JSON. Occurrences without a `score` key are skipped
 * (the page repeats the key in several script blobs).
 */
function extractScoreObject(html: string, key: string): number | null {
  const marker = `"${key}":`
  let from = 0
  for (;;) {
    const idx = html.indexOf(marker, from)
    if (idx === -1) return null
    from = idx + marker.length
    const start = html.indexOf("{", from)
    if (start === -1 || start > from + 4) continue
    let depth = 0
    let inString = false
    for (let i = start; i < html.length; i++) {
      const ch = html[i]
      if (inString) {
        if (ch === "\\") i++
        else if (ch === '"') inString = false
      } else if (ch === '"') inString = true
      else if (ch === "{") depth++
      else if (ch === "}") {
        depth--
        if (depth === 0) {
          try {
            const obj = JSON.parse(html.slice(start, i + 1)) as {
              score?: string | number
            }
            const score = Number(obj.score)
            if (obj.score !== "" && Number.isFinite(score)) return score
          } catch {
            // Malformed slice — try the next occurrence.
          }
          break
        }
      }
    }
  }
}

/** Search for a title and scrape its critic + audience scores. */
export async function fetchRtScores(
  title: string,
  year: number | null,
  mediaType: "movie" | "tv" | null,
): Promise<RtResult | null> {
  const url = await searchRtUrl(title, year, mediaType)
  if (!url) return null
  const page = await fetchPageWithFallback(url)
  if (!page.ok) return null
  return {
    url,
    criticsScore: extractScoreObject(page.html, "criticsScore"),
    audienceScore: extractScoreObject(page.html, "audienceScore"),
  }
}

/**
 * Backfill scores for films never scraped before (rt_synced_at is null).
 * Attempts are recorded even when unmatched so the sync doesn't rescan the
 * same misses forever — use the per-film refresh to retry one title.
 */
export const syncRottenTomatoesFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const pending = await withUser(context.userId, (tx) =>
      tx
        .select({
          id: films.id,
          title: films.title,
          year: films.year,
          tmdbMediaType: films.tmdbMediaType,
        })
        .from(films)
        .where(isNull(films.rtSyncedAt)),
    )

    let updated = 0
    let unmatched = 0
    for (const film of pending) {
      const result = await fetchRtScores(
        film.title,
        film.year,
        film.tmdbMediaType === "tv"
          ? "tv"
          : film.tmdbMediaType === "movie"
            ? "movie"
            : null,
      )
      await withUser(context.userId, (tx) =>
        tx
          .update(films)
          .set({
            rtSyncedAt: new Date(),
            ...toRtScoreUpdate(result),
            updatedAt: new Date(),
          })
          .where(eq(films.id, film.id)),
      )
      if (result) updated++
      else unmatched++
      // Two page fetches per film — keep a polite gap between titles.
      await new Promise((resolve) => setTimeout(resolve, 400))
    }

    return { ok: true as const, scanned: pending.length, updated, unmatched }
  })

/** Re-scrape one film's scores on demand (also retries earlier misses). */
export const refreshRtScoresFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ context, data }) => {
    const rows = await withUser(context.userId, (tx) =>
      tx
        .select({
          id: films.id,
          title: films.title,
          year: films.year,
          tmdbMediaType: films.tmdbMediaType,
        })
        .from(films)
        .where(eq(films.id, data.id))
        .limit(1),
    )
    const film = rows.at(0)
    if (!film) return { ok: false as const, error: "Film not found." }

    const result = await fetchRtScores(
      film.title,
      film.year,
      film.tmdbMediaType === "tv"
        ? "tv"
        : film.tmdbMediaType === "movie"
          ? "movie"
          : null,
    )
    await withUser(context.userId, (tx) =>
      tx
        .update(films)
        .set({
          rtSyncedAt: new Date(),
          ...toRtScoreUpdate(result),
          updatedAt: new Date(),
        })
        .where(eq(films.id, film.id)),
    )
    if (!result) {
      return {
        ok: false as const,
        error: "No Rotten Tomatoes match found for this title.",
      }
    }
    return { ok: true as const, ...result }
  })
