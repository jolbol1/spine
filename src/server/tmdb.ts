import { createServerFn } from "@tanstack/react-start"
import { eq, isNull } from "drizzle-orm"
import { z } from "zod"
import { films, withUser } from "@/db"
import type { CastMember, TmdbDetails } from "@/db/schema"
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
  /** Director name(s) — movies only; TV series direct per-episode. */
  directors: string[]
  posterUrl: string | null
  details: TmdbDetails | null
}

interface TmdbCredits {
  cast?: Array<{
    id: number
    name: string
    character?: string
    roles?: Array<{ character?: string }>
    profile_path?: string | null
  }>
  crew?: Array<{ name: string; job?: string }>
}

interface TmdbDetailPayload {
  imdb_id?: string | null
  external_ids?: { imdb_id?: string | null }
  genres?: Array<{ name: string }>
  production_companies?: Array<{ name: string }>
  production_countries?: Array<{ name: string }>
  original_language?: string
  budget?: number
  revenue?: number
  vote_average?: number
  belongs_to_collection?: { name: string } | null
  /** Movies: append_to_response=release_dates. */
  release_dates?: {
    results?: Array<{
      iso_3166_1: string
      release_dates?: Array<{ certification?: string }>
    }>
  }
  /** TV: append_to_response=content_ratings. */
  content_ratings?: {
    results?: Array<{ iso_3166_1: string; rating?: string }>
  }
}

/** Age rating, preferring the GB certification, falling back to US. */
function parseCertification(detail: TmdbDetailPayload): string | null {
  for (const country of ["GB", "US"]) {
    const release = detail.release_dates?.results?.find(
      (r) => r.iso_3166_1 === country
    )
    const cert = release?.release_dates?.find(
      (d) => d.certification
    )?.certification
    if (cert) return cert
    const rating = detail.content_ratings?.results?.find(
      (r) => r.iso_3166_1 === country
    )?.rating
    if (rating) return rating
  }
  return null
}

const parseCast = (credits: TmdbCredits): CastMember[] =>
  (credits.cast ?? []).slice(0, CAST_LIMIT).map((member) => ({
    id: member.id,
    name: member.name,
    character: member.character ?? member.roles?.[0]?.character ?? null,
    profilePath: member.profile_path ?? null,
  }))

const parseDirectors = (
  credits: TmdbCredits,
  mediaType: "movie" | "tv"
): string[] =>
  mediaType === "movie"
    ? [
        ...new Set(
          (credits.crew ?? [])
            .filter((member) => member.job === "Director")
            .map((member) => member.name)
        ),
      ]
    : []

const parseDetails = (detail: TmdbDetailPayload): TmdbDetails => ({
  imdbId: detail.imdb_id ?? detail.external_ids?.imdb_id ?? null,
  genres: (detail.genres ?? []).map((g) => g.name),
  productionCompanies: (detail.production_companies ?? []).map((c) => c.name),
  productionCountries: (detail.production_countries ?? []).map((c) => c.name),
  originalLanguage: detail.original_language ?? null,
  budget: detail.budget || null,
  revenue: detail.revenue || null,
  voteAverage: detail.vote_average || null,
  collection: detail.belongs_to_collection?.name ?? null,
  certification: parseCertification(detail),
})

/** Certification lives on a per-media-type sub-resource. */
const certificationAppend = (mediaType: "movie" | "tv") =>
  mediaType === "tv" ? "content_ratings" : "release_dates"

/**
 * Fetch a title straight by TMDB id — used when the user supplies the id
 * manually and by the backfills for films whose id is already known.
 * Without a media-type hint it tries movie first, then TV.
 */
export async function fetchTmdbById(
  tmdbId: number,
  hint?: "movie" | "tv" | null
): Promise<TmdbMatch | null> {
  if (!env.TMDB_API_KEY) return null
  const types: Array<"movie" | "tv"> = hint ? [hint] : ["movie", "tv"]
  for (const mediaType of types) {
    try {
      const credits = mediaType === "tv" ? "aggregate_credits" : "credits"
      const res = await tmdbFetch(`/${mediaType}/${tmdbId}`, {
        append_to_response: `${credits},external_ids,${certificationAppend(mediaType)}`,
      })
      if (!res.ok) continue
      const detail = (await res.json()) as TmdbDetailPayload & {
        poster_path?: string | null
        credits?: TmdbCredits
        aggregate_credits?: TmdbCredits
      }
      const creditsPayload =
        (mediaType === "tv" ? detail.aggregate_credits : detail.credits) ?? {}
      return {
        tmdbId,
        mediaType,
        cast: parseCast(creditsPayload),
        directors: parseDirectors(creditsPayload, mediaType),
        posterUrl: detail.poster_path
          ? `https://image.tmdb.org/t/p/w500${detail.poster_path}`
          : null,
        details: parseDetails(detail),
      }
    } catch {
      // Try the next media type.
    }
  }
  return null
}

/**
 * Fetch title-level metadata for a known TMDB id — genres, production
 * companies/countries, budget/revenue, community rating, franchise, and the
 * IMDb id (which also powers the film's IMDb link).
 */
export async function fetchTmdbDetails(
  tmdbId: number,
  mediaType: "movie" | "tv"
): Promise<TmdbDetails | null> {
  if (!env.TMDB_API_KEY) return null
  try {
    const res = await tmdbFetch(`/${mediaType}/${tmdbId}`, {
      append_to_response: `external_ids,${certificationAppend(mediaType)}`,
    })
    if (!res.ok) return null
    return parseDetails((await res.json()) as TmdbDetailPayload)
  } catch {
    return null
  }
}

/**
 * Find a film or TV show on TMDB by title (+year when known) and return its
 * top-billed cast, directors, and poster — used to fill whatever the disc
 * source (Blu-ray.com / CEX / manual entry) didn't provide.
 * Returns null when TMDB is not configured or no match.
 */
export async function fetchTmdbCast(
  title: string,
  year: number | null
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
        poster_path?: string | null
      }>
    }

    const candidates = (search.results ?? []).filter(
      (r) => r.media_type === "movie" || r.media_type === "tv"
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
    const credits = (await creditsRes.json()) as TmdbCredits

    return {
      tmdbId: match.id,
      mediaType,
      cast: parseCast(credits),
      directors: parseDirectors(credits, mediaType),
      posterUrl: match.poster_path
        ? `https://image.tmdb.org/t/p/w500${match.poster_path}`
        : null,
      details: await fetchTmdbDetails(match.id, mediaType),
    }
  } catch {
    return null
  }
}

export interface TmdbTitleMatch {
  tmdbId: number
  mediaType: "movie" | "tv"
  title: string
  year: number | null
  posterUrl: string | null
}

/** Straight TMDB title search — canonical matches for fuzzy web results. */
export async function searchTmdbTitles(
  query: string,
  limit = 5
): Promise<TmdbTitleMatch[]> {
  if (!env.TMDB_API_KEY) return []
  try {
    const res = await tmdbFetch("/search/multi", {
      query,
      include_adult: "false",
    })
    if (!res.ok) return []
    const payload = (await res.json()) as {
      results?: Array<{
        id: number
        media_type: string
        title?: string
        name?: string
        release_date?: string
        first_air_date?: string
        poster_path?: string | null
      }>
    }
    return (payload.results ?? [])
      .filter((r) => r.media_type === "movie" || r.media_type === "tv")
      .slice(0, limit)
      .map((r) => {
        const date = r.release_date ?? r.first_air_date
        return {
          tmdbId: r.id,
          mediaType: r.media_type as "movie" | "tv",
          title: r.title ?? r.name ?? "Unknown",
          year: date ? Number(date.slice(0, 4)) || null : null,
          posterUrl: r.poster_path
            ? `https://image.tmdb.org/t/p/w342${r.poster_path}`
            : null,
        }
      })
  } catch {
    return []
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
        .select({
          id: films.id,
          title: films.title,
          year: films.year,
          tmdbId: films.tmdbId,
          tmdbMediaType: films.tmdbMediaType,
        })
        .from(films)
        .where(isNull(films.tmdbCast))
    )

    let updated = 0
    let unmatched = 0
    for (const film of pending) {
      // A stored id (from an earlier match or entered manually) wins over
      // the title search.
      const result = film.tmdbId
        ? await fetchTmdbById(
            film.tmdbId,
            film.tmdbMediaType === "tv" ? "tv" : "movie"
          )
        : await fetchTmdbCast(film.title, film.year)
      if (result) {
        await withUser(context.userId, (tx) =>
          tx
            .update(films)
            .set({
              tmdbId: result.tmdbId,
              tmdbMediaType: result.mediaType,
              tmdbCast: result.cast,
              tmdbDetails: result.details,
              updatedAt: new Date(),
            })
            .where(eq(films.id, film.id))
        )
        updated++
      } else {
        unmatched++
      }
      await new Promise((resolve) => setTimeout(resolve, 150))
    }

    return { ok: true as const, scanned: pending.length, updated, unmatched }
  })

/**
 * Backfill title-level TMDB details (genres, production companies, budget,
 * IMDb id, …) for films that don't have them yet. Films whose TMDB id is
 * already known skip the search round-trip; the rest match by title + year.
 */
export const syncTmdbDetailsFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    if (!env.TMDB_API_KEY) {
      return {
        ok: false as const,
        error: "Set TMDB_API_KEY in .env to enable TMDB lookups.",
      }
    }

    const pending = await withUser(context.userId, (tx) =>
      tx
        .select({
          id: films.id,
          title: films.title,
          year: films.year,
          tmdbId: films.tmdbId,
          tmdbMediaType: films.tmdbMediaType,
        })
        .from(films)
        .where(isNull(films.tmdbDetails))
    )

    let updated = 0
    let unmatched = 0
    for (const film of pending) {
      let patch: Partial<typeof films.$inferInsert> | null = null
      if (film.tmdbId != null) {
        const details = await fetchTmdbDetails(
          film.tmdbId,
          film.tmdbMediaType === "tv" ? "tv" : "movie"
        )
        if (details) patch = { tmdbDetails: details }
      } else {
        const result = await fetchTmdbCast(film.title, film.year)
        if (result?.details) {
          patch = {
            tmdbId: result.tmdbId,
            tmdbMediaType: result.mediaType,
            tmdbCast: result.cast,
            tmdbDetails: result.details,
          }
        }
      }

      if (patch) {
        await withUser(context.userId, (tx) =>
          tx
            .update(films)
            .set({ ...patch, updatedAt: new Date() })
            .where(eq(films.id, film.id))
        )
        updated++
      } else {
        unmatched++
      }
      await new Promise((resolve) => setTimeout(resolve, 150))
    }

    return { ok: true as const, scanned: pending.length, updated, unmatched }
  })

/**
 * Retry the TMDB match for one film — used from the film page after the
 * user fixes a title or year that didn't match on add. Also refreshes
 * cast/details when a match already exists.
 */
export const rematchTmdbFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ context, data }) => {
    if (!env.TMDB_API_KEY) {
      return {
        ok: false as const,
        error: "Set TMDB_API_KEY in .env to enable TMDB lookups.",
      }
    }
    const rows = await withUser(context.userId, (tx) =>
      tx
        .select({
          id: films.id,
          title: films.title,
          year: films.year,
          tmdbId: films.tmdbId,
          tmdbMediaType: films.tmdbMediaType,
        })
        .from(films)
        .where(eq(films.id, data.id))
        .limit(1)
    )
    const film = rows.at(0)
    if (!film) return { ok: false as const, error: "Film not found." }

    const result = film.tmdbId
      ? await fetchTmdbById(
          film.tmdbId,
          film.tmdbMediaType === "tv" ? "tv" : "movie"
        )
      : await fetchTmdbCast(film.title, film.year)
    if (!result) {
      return {
        ok: false as const,
        error: `TMDB has no match for “${film.title}”${film.year ? ` (${film.year})` : ""}. Try adjusting the title or year.`,
      }
    }
    await withUser(context.userId, (tx) =>
      tx
        .update(films)
        .set({
          tmdbId: result.tmdbId,
          tmdbMediaType: result.mediaType,
          tmdbCast: result.cast,
          tmdbDetails: result.details,
          updatedAt: new Date(),
        })
        .where(eq(films.id, film.id))
    )
    return { ok: true as const, castCount: result.cast.length }
  })

/**
 * Resolve a person's IMDb page. Cast members carry their TMDB person id;
 * directors are stored as bare names, so those fall back to a person search.
 */
export const getPersonImdbFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      name: z.string().trim().min(1).max(300),
      tmdbPersonId: z.number().int().positive().nullish(),
    })
  )
  .handler(async ({ data }) => {
    if (!env.TMDB_API_KEY) return { imdbId: null, tmdbPersonId: null }
    try {
      let personId = data.tmdbPersonId ?? null
      if (personId == null) {
        const searchRes = await tmdbFetch("/search/person", {
          query: data.name,
          include_adult: "false",
        })
        if (!searchRes.ok) return { imdbId: null, tmdbPersonId: null }
        const search = (await searchRes.json()) as {
          results?: Array<{ id: number; name: string }>
        }
        const norm = (s: string) => s.trim().toLowerCase()
        const match =
          (search.results ?? []).find(
            (r) => norm(r.name) === norm(data.name)
          ) ?? search.results?.[0]
        personId = match?.id ?? null
      }
      if (personId == null) return { imdbId: null, tmdbPersonId: null }

      const idsRes = await tmdbFetch(`/person/${personId}/external_ids`, {})
      if (!idsRes.ok) return { imdbId: null, tmdbPersonId: personId }
      const ids = (await idsRes.json()) as { imdb_id?: string | null }
      return { imdbId: ids.imdb_id ?? null, tmdbPersonId: personId }
    } catch {
      return { imdbId: null, tmdbPersonId: null }
    }
  })
