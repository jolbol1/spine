import { createServerFn } from "@tanstack/react-start"
import { XMLParser } from "fast-xml-parser"
import { eq } from "drizzle-orm"
import { films, userSettings, withUser } from "@/db"
import { authMiddleware } from "@/server/middleware"

interface RssItem {
  "letterboxd:filmTitle"?: string | number
  "letterboxd:filmYear"?: number
  "letterboxd:rewatch"?: string
  "letterboxd:watchedDate"?: string
}

function normalizeTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, " ")
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

    let xml: string
    try {
      const res = await fetch(
        `https://letterboxd.com/${encodeURIComponent(username)}/rss/`,
        {
          headers: { "User-Agent": "Mozilla/5.0 (Spine collection tracker)" },
          signal: AbortSignal.timeout(15_000),
        }
      )
      if (!res.ok) {
        return {
          ok: false as const,
          error:
            res.status === 404
              ? `Letterboxd user “${username}” not found.`
              : `Letterboxd returned ${res.status}.`,
        }
      }
      xml = await res.text()
    } catch {
      return { ok: false as const, error: "Could not reach Letterboxd." }
    }

    const parser = new XMLParser({ ignoreAttributes: true })
    const doc = parser.parse(xml)
    const rawItems = doc?.rss?.channel?.item
    const items: RssItem[] = Array.isArray(rawItems)
      ? rawItems
      : rawItems
        ? [rawItems]
        : []

    // First-time watches only; ignore list entries and rewatches.
    const firstWatches = items.filter(
      (item) =>
        item["letterboxd:filmTitle"] != null &&
        item["letterboxd:watchedDate"] &&
        item["letterboxd:rewatch"] !== "Yes"
    )

    const collection = await withUser(context.userId, (tx) =>
      tx
        .select({
          id: films.id,
          title: films.title,
          year: films.year,
          letterboxdWatched: films.letterboxdWatched,
        })
        .from(films)
    )

    let matched = 0
    for (const entry of firstWatches) {
      const entryTitle = normalizeTitle(String(entry["letterboxd:filmTitle"]))
      const entryYear = entry["letterboxd:filmYear"]
        ? Number(entry["letterboxd:filmYear"])
        : null

      const targets = collection.filter((film) => {
        if (normalizeTitle(film.title) !== entryTitle) return false
        if (film.year == null || entryYear == null) return true
        return film.year === entryYear
      })

      for (const film of targets) {
        if (film.letterboxdWatched) continue
        await withUser(context.userId, (tx) =>
          tx
            .update(films)
            .set({
              letterboxdWatched: true,
              letterboxdWatchedAt: new Date(
                `${entry["letterboxd:watchedDate"]}T00:00:00Z`
              ),
              updatedAt: new Date(),
            })
            .where(eq(films.id, film.id))
        )
        matched++
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
      scanned: firstWatches.length,
      matched,
    }
  })
