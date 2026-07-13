import { createServerFn } from "@tanstack/react-start"
import { XMLParser } from "fast-xml-parser"
import { eq } from "drizzle-orm"
import { films, userSettings, withUser } from "@/db"
import { env } from "@/env"
import { authMiddleware } from "@/server/middleware"
import { fetchPageWithFallback } from "@/server/scrape"

interface RssItem {
  "letterboxd:filmTitle"?: string | number
  "letterboxd:filmYear"?: number
  "letterboxd:rewatch"?: string
  "letterboxd:watchedDate"?: string
  "letterboxd:memberRating"?: number | string
  "letterboxd:memberLike"?: string
  "tmdb:movieId"?: number | string
  description?: string
  link?: string
}

function normalizeTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, " ")
}

/**
 * Pull the review text out of an RSS item's description — HTML with the
 * poster in one <p> and the review in the rest. Entries logged without a
 * review just carry the poster (and sometimes a "Watched on …" line).
 */
export function reviewFromRssDescription(html: string): string | null {
  const paragraphs = [...html.matchAll(/<p>([\s\S]*?)<\/p>/g)]
    .map((m) => m[1])
    .filter((p) => !/<img\b/i.test(p))
    .map((p) => decodeHtml(p.replace(/<[^>]+>/g, "")).trim())
    .filter((p) => p !== "" && !/^Watched on /.test(p))
  return paragraphs.join("\n\n") || null
}

/**
 * Sync watched state from the user's Letterboxd RSS feed.
 * First-time watches only — entries marked as rewatches are ignored.
 * Films with a manual override keep their pinned state (the sync still
 * records the Letterboxd value underneath).
 */
export const syncLetterboxdFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const settings = await withUser(context.userId, (tx) =>
      tx
        .select()
        .from(userSettings)
        .where(eq(userSettings.userId, context.userId))
        .limit(1)
    )
    const username = settings[0]?.letterboxdUsername
    if (!username) {
      return {
        ok: false as const,
        error: "Set your Letterboxd username in Settings first.",
      }
    }

    const feed = await fetchLetterboxdPage(
      `https://letterboxd.com/${encodeURIComponent(username)}/rss/`,
    )
    if (!feed.ok) {
      return {
        ok: false as const,
        error:
          feed.status === "notfound"
            ? `Letterboxd user “${username}” not found.`
            : env.FIRECRAWL_API_KEY
              ? "Letterboxd is blocking requests right now — try again in a few minutes."
              : "Letterboxd is blocking this server's requests. Set FIRECRAWL_API_KEY in .env so the sync can route around it.",
      }
    }
    const xml = feed.html

    const parser = new XMLParser({ ignoreAttributes: true })
    const doc = parser.parse(xml)
    const rawItems = doc?.rss?.channel?.item
    const items: RssItem[] = Array.isArray(rawItems)
      ? rawItems
      : rawItems
        ? [rawItems]
        : []

    // Diary entries only (they carry a watched date). Rewatches still
    // update the rating/review — they just never change the first-watch date.
    const logEntries = items.filter(
      (item) =>
        item["letterboxd:filmTitle"] != null &&
        item["letterboxd:watchedDate"],
    )

    const collection = await withUser(context.userId, (tx) =>
      tx
        .select({
          id: films.id,
          title: films.title,
          year: films.year,
          letterboxdWatched: films.letterboxdWatched,
          tmdbId: films.tmdbId,
          tmdbMediaType: films.tmdbMediaType,
        })
        .from(films)
    )

    let matched = 0
    // The feed is newest-first — the first entry seen per film carries the
    // freshest rating/review, so later (older) entries must not overwrite.
    const detailsApplied = new Set<string>()
    for (const entry of logEntries) {
      const entryTitle = normalizeTitle(String(entry["letterboxd:filmTitle"]))
      const entryYear = entry["letterboxd:filmYear"]
        ? Number(entry["letterboxd:filmYear"])
        : null
      const entryTmdbId = entry["tmdb:movieId"]
        ? Number(entry["tmdb:movieId"]) || null
        : null

      // The feed's TMDB id beats fuzzy title matching when both sides know it.
      const byId =
        entryTmdbId != null
          ? collection.filter(
              (film) =>
                film.tmdbId === entryTmdbId && film.tmdbMediaType !== "tv",
            )
          : []
      const targets =
        byId.length > 0
          ? byId
          : collection.filter((film) => {
              if (normalizeTitle(film.title) !== entryTitle) return false
              if (film.year == null || entryYear == null) return true
              return film.year === entryYear
            })

      const rating = entry["letterboxd:memberRating"]
        ? Number(entry["letterboxd:memberRating"]) || null
        : null
      const review = reviewFromRssDescription(entry.description ?? "")
      const isRewatch = entry["letterboxd:rewatch"] === "Yes"

      for (const film of targets) {
        const patch: Partial<typeof films.$inferInsert> = {}
        if (!detailsApplied.has(film.id)) {
          detailsApplied.add(film.id)
          if (rating != null) patch.letterboxdRating = rating
          if (review != null) patch.letterboxdReview = review
          if (entry["letterboxd:memberLike"] != null) {
            patch.letterboxdLiked = entry["letterboxd:memberLike"] === "Yes"
          }
          if (entry.link) patch.letterboxdUri = entry.link
        }
        if (!isRewatch && !film.letterboxdWatched) {
          patch.letterboxdWatched = true
          patch.letterboxdWatchedAt = new Date(
            `${entry["letterboxd:watchedDate"]}T00:00:00Z`,
          )
          film.letterboxdWatched = true
          matched++
        }
        if (Object.keys(patch).length === 0) continue
        await withUser(context.userId, (tx) =>
          tx
            .update(films)
            .set({ ...patch, updatedAt: new Date() })
            .where(eq(films.id, film.id))
        )
      }
    }

    await withUser(context.userId, (tx) =>
      tx
        .insert(userSettings)
        .values({ userId: context.userId, lastLetterboxdSyncAt: new Date() })
        .onConflictDoUpdate({
          target: userSettings.userId,
          set: { lastLetterboxdSyncAt: new Date() },
        })
    )

    return {
      ok: true as const,
      scanned: logEntries.length,
      matched,
    }
  })


// ---------------------------------------------------------------------------
// Full-history sync — scrapes letterboxd.com/<user>/diary/ page by page.
// Unlike the RSS feed (~50 recent entries) the diary is the whole log, and
// unlike the films grid it carries watch dates, ratings, and review links.
// ---------------------------------------------------------------------------

const MAX_DIARY_PAGES = 120 // ~6,000 entries — a runaway backstop

const fetchLetterboxdPage = fetchPageWithFallback

function decodeHtml(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
}

interface DiaryFilm {
  title: string
  year: number | null
  firstWatched: Date
  /** Most recent rating given (diary is newest-first). */
  rating: number | null
  /** The ♥ on the most recent entry. */
  liked: boolean
  /** The user's review page when any entry has a review, else their film page. */
  uri: string
  /** Review page to follow for the text — diary rows only carry the link. */
  reviewUri: string | null
}

/**
 * Parse one diary page's entry rows. Rows look like:
 *   data-item-name="Boogie Nights (1997)" … data-item-slug="boogie-nights"
 *   <a class="daydate" href="/user/diary/films/for/2026/07/11/">11</a>
 *   <span class="rating rated-8">★★★★</span>          (rated-N = N half-stars)
 *   <td class="col-review …"><a href="/user/film/…" … icon-review
 */
export function parseDiaryPage(
  html: string,
  username: string,
  entries: Map<string, DiaryFilm>,
): number {
  const rows = html.split(/class="diary-entry-row/).slice(1)
  for (const row of rows) {
    const name = row.match(/data-item-name="([^"]+)"/)?.[1]
    const slug = row.match(/data-item-slug="([^"]+)"/)?.[1]
    const date = row.match(
      /class="daydate" href="[^"]*\/for\/(\d{4})\/(\d{2})\/(\d{2})\//,
    )
    if (!name || !slug || !date) continue

    const decoded = decodeHtml(name)
    const yearMatch = decoded.match(/\s*\(((?:19|20)\d{2})\)\s*$/)
    const watched = new Date(`${date[1]}-${date[2]}-${date[3]}T00:00:00Z`)
    const ratingHalf = row.match(/class="rating rated-(\d+)"/)?.[1]
    const reviewHref = row.match(
      /col-review[^>]*>\s*<a href="([^"]+)"[^>]*icon-review/,
    )?.[1]
    // Firecrawl's rawHtml rewrites hrefs to absolute URLs; direct
    // fetches keep them relative — handle both.
    const reviewUri = reviewHref
      ? reviewHref.startsWith("http")
        ? reviewHref
        : `https://letterboxd.com${reviewHref}`
      : null

    const existing = entries.get(slug)
    if (existing) {
      // Diary is newest-first: keep the first-seen rating/review (most
      // recent) and let the watch date sink to the earliest entry.
      if (watched < existing.firstWatched) existing.firstWatched = watched
      existing.rating ??= ratingHalf ? Number(ratingHalf) / 2 : null
      existing.reviewUri ??= reviewUri
    } else {
      entries.set(slug, {
        title: yearMatch
          ? decoded.slice(0, yearMatch.index).trim()
          : decoded,
        year: yearMatch ? Number(yearMatch[1]) : null,
        firstWatched: watched,
        rating: ratingHalf ? Number(ratingHalf) / 2 : null,
        liked: /icon-liked/.test(row),
        reviewUri,
        uri:
          reviewUri ?? `https://letterboxd.com/${username}/film/${slug}/`,
      })
    }
  }
  return rows.length
}

/**
 * Review text from the user's Letterboxd review page — the diary only
 * links to it. Falls back to og:description (a plain-text copy).
 */
export function extractReviewFromPage(html: string): string | null {
  const body = /js-review-body[^>]*>([\s\S]*?)<\/div>/.exec(html)?.[1]
  if (body) {
    const paragraphs = [...body.matchAll(/<p>([\s\S]*?)<\/p>/g)]
      .map((m) => decodeHtml(m[1].replace(/<[^>]+>/g, "")).trim())
      .filter(Boolean)
    if (paragraphs.length > 0) return paragraphs.join("\n\n")
  }
  const og = /<meta property="og:description" content="([^"]*)"/.exec(
    html,
  )?.[1]
  return og ? decodeHtml(og).trim() || null : null
}

/**
 * Sync the user's entire Letterboxd diary: earliest watch date per film,
 * their star rating, and a link to their review/film page. Manual
 * overrides still win in the UI.
 */
export const syncLetterboxdHistoryFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const settings = await withUser(context.userId, (tx) =>
      tx
        .select()
        .from(userSettings)
        .where(eq(userSettings.userId, context.userId))
        .limit(1),
    )
    const username = settings[0]?.letterboxdUsername
    if (!username) {
      return {
        ok: false as const,
        error: "Set your Letterboxd username in Settings first.",
      }
    }

    const diary = new Map<string, DiaryFilm>()
    let pages = 0
    // Once a direct fetch gets blocked, stay on Firecrawl for the rest.
    let viaFirecrawl = false
    for (let page = 1; page <= MAX_DIARY_PAGES; page++) {
      const result = await fetchLetterboxdPage(
        `https://letterboxd.com/${encodeURIComponent(username)}/diary/page/${page}/`,
        viaFirecrawl,
      )
      if (!result.ok) {
        if (page > 1) break // keep what we have
        if (result.status === "notfound") {
          return {
            ok: false as const,
            error: `Letterboxd user “${username}” not found.`,
          }
        }
        return {
          ok: false as const,
          error: env.FIRECRAWL_API_KEY
            ? "Letterboxd is blocking requests right now — try again in a few minutes."
            : "Letterboxd is blocking this server's requests. Set FIRECRAWL_API_KEY in .env so the sync can route around it.",
        }
      }
      viaFirecrawl = result.via === "firecrawl"

      const rowCount = parseDiaryPage(result.html, username, diary)
      if (rowCount === 0) break
      pages++
      // Be polite to Letterboxd (Firecrawl paces itself).
      if (!viaFirecrawl) {
        await new Promise((resolve) => setTimeout(resolve, 400))
      }
    }

    if (diary.size === 0) {
      return {
        ok: false as const,
        error: "No diary entries found on that Letterboxd profile.",
      }
    }

    const collection = await withUser(context.userId, (tx) =>
      tx
        .select({
          id: films.id,
          title: films.title,
          year: films.year,
          letterboxdReview: films.letterboxdReview,
        })
        .from(films),
    )

    // Index diary films by normalized title.
    const byTitle = new Map<string, DiaryFilm[]>()
    for (const entry of diary.values()) {
      const key = normalizeTitle(entry.title)
      const list = byTitle.get(key)
      if (list) list.push(entry)
      else byTitle.set(key, [entry])
    }

    let matched = 0
    const reviewsToFetch: Array<{ filmId: string; uri: string }> = []
    for (const film of collection) {
      const entries = byTitle.get(normalizeTitle(film.title))
      const hit = entries?.find(
        (entry) =>
          film.year == null ||
          entry.year == null ||
          Math.abs(entry.year - film.year) <= 1,
      )
      if (!hit) continue
      await withUser(context.userId, (tx) =>
        tx
          .update(films)
          .set({
            letterboxdWatched: true,
            letterboxdWatchedAt: hit.firstWatched,
            letterboxdRating: hit.rating,
            letterboxdLiked: hit.liked,
            letterboxdUri: hit.uri,
            updatedAt: new Date(),
          })
          .where(eq(films.id, film.id)),
      )
      matched++
      // Diary rows only link to reviews — fetch the text below unless an
      // earlier sync (or the RSS feed) already stored it.
      if (hit.reviewUri && film.letterboxdReview == null) {
        reviewsToFetch.push({ filmId: film.id, uri: hit.reviewUri })
      }
    }

    let reviews = 0
    for (const { filmId, uri } of reviewsToFetch) {
      const page = await fetchLetterboxdPage(uri, viaFirecrawl)
      if (!page.ok) continue
      viaFirecrawl = page.via === "firecrawl"
      const review = extractReviewFromPage(page.html)
      if (!review) continue
      await withUser(context.userId, (tx) =>
        tx
          .update(films)
          .set({ letterboxdReview: review, updatedAt: new Date() })
          .where(eq(films.id, filmId)),
      )
      reviews++
      if (!viaFirecrawl) {
        await new Promise((resolve) => setTimeout(resolve, 400))
      }
    }

    await withUser(context.userId, (tx) =>
      tx
        .insert(userSettings)
        .values({ userId: context.userId, lastLetterboxdSyncAt: new Date() })
        .onConflictDoUpdate({
          target: userSettings.userId,
          set: { lastLetterboxdSyncAt: new Date() },
        }),
    )

    return {
      ok: true as const,
      pages,
      filmsSeen: diary.size,
      matched,
      reviews,
    }
  })
