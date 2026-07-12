import { createServerFn } from "@tanstack/react-start"
import { eq, isNull } from "drizzle-orm"
import { films, withUser } from "@/db"
import type { CastMember } from "@/db/schema"
import { env } from "@/env"
import { authMiddleware } from "@/server/middleware"

const TMDB_BASE = "https://api.themoviedb.org/3"
const CAST_LIMIT = 12

/** Supports both v3 api keys and v4 read access tokens ("eyJ…"). */
function tmdbFetch(path: string, params: Record<string, string>) {
  const url = new URL(TMDB_BASE + path)
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value)
  }
  const headers: Record<string, string> = { Accept: "application/json" }
  const key = env.TMDB_API_KEY!
  if (key.startsWith("eyJ")) {
    headers.Authorization = `Bearer ${key}`
  } else {
    url.searchParams.set("api_key", key)
  }
  return fetch(url, { headers, signal: AbortSignal.timeout(10_000) })
}

interface TmdbMatch {
  tmdbId: number
  mediaType: "movie" | "tv"
  cast: CastMember[]
}

/**
 * Find a film or TV show on TMDB by title (+year when known) and return its
 * top-billed cast. Returns null when TMDB is not configured or no match.
 */
export async function fetchTmdbCast(
  title: string,
  year: number | null,
): Promise<TmdbMatch | null> {
  if (!env.TMDB_API_KEY) return null

  try {
    const searchRes = await tmdbFetch("/search/multi", {
      query: title,
      include_adult: "false",
    })
    if (!searchRes.ok) return null
    const search = (await searchRes.json()) as {
      results?: Array<{
        id: number
        media_type: string
        release_date?: string
        first_air_date?: string
      }>
    }

    const candidates = (search.results ?? []).filter(
      (r) => r.media_type === "movie" || r.media_type === "tv",
    )
    if (candidates.length === 0) return null

    // Prefer a year match (±1 for regional release differences).
    const yearOf = (r: (typeof candidates)[number]) => {
      const date = r.release_date ?? r.first_air_date
      return date ? Number(date.slice(0, 4)) : null
    }
    const match =
      (year != null
        ? candidates.find((r) => {
            const y = yearOf(r)
            return y != null && Math.abs(y - year) <= 1
          })
        : undefined) ?? candidates[0]

    const mediaType = match.media_type as "movie" | "tv"
    const creditsPath =
      mediaType === "tv"
        ? `/tv/${match.id}/aggregate_credits`
        : `/movie/${match.id}/credits`
    const creditsRes = await tmdbFetch(creditsPath, {})
    if (!creditsRes.ok) return null
    const credits = (await creditsRes.json()) as {
      cast?: Array<{
        id: number
        name: string
        character?: string
        roles?: Array<{ character?: string }>
        profile_path?: string | null
      }>
    }

    const cast: CastMember[] = (credits.cast ?? [])
      .slice(0, CAST_LIMIT)
      .map((member) => ({
        id: member.id,
        name: member.name,
        character:
          member.character ?? member.roles?.[0]?.character ?? null,
        profilePath: member.profile_path ?? null,
      }))

    return { tmdbId: match.id, mediaType, cast }
  } catch {
    return null
  }
}

/**
 * Backfill cast for films that don't have it yet (e.g. added before TMDB
 * was configured). Sequential with a small delay to stay friendly to the API.
 */
export const syncTmdbCastFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    if (!env.TMDB_API_KEY) {
      return {
        ok: false as const,
        error: "Set TMDB_API_KEY in .env to enable cast lookups.",
      }
    }

    const pending = await withUser(context.userId, (tx) =>
      tx
        .select({ id: films.id, title: films.title, year: films.year })
        .from(films)
        .where(isNull(films.tmdbCast)),
    )

    let updated = 0
    let unmatched = 0
    for (const film of pending) {
      const result = await fetchTmdbCast(film.title, film.year)
      if (result) {
        await withUser(context.userId, (tx) =>
          tx
            .update(films)
            .set({
              tmdbId: result.tmdbId,
              tmdbMediaType: result.mediaType,
              tmdbCast: result.cast,
              updatedAt: new Date(),
            })
            .where(eq(films.id, film.id)),
        )
        updated++
      } else {
        unmatched++
      }
      await new Promise((resolve) => setTimeout(resolve, 150))
    }

    return { ok: true as const, scanned: pending.length, updated, unmatched }
  })
