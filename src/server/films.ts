import { createServerFn } from "@tanstack/react-start"
import { asc, eq } from "drizzle-orm"
import { z } from "zod"
import { films, withUser } from "@/db"
import { filmFormatSchema } from "@/lib/film-formats"
import { toSortTitle } from "@/lib/film-helpers"
import { isCriterionLabel, lookupSpine } from "@/server/criterion-data"
import { authMiddleware } from "@/server/middleware"
import { fetchRtScores } from "@/server/rottentomatoes"
import { fetchTmdbById, fetchTmdbCast } from "@/server/tmdb"

const filmInput = z.object({
  title: z.string().trim().min(1).max(500),
  director: z.string().trim().max(500).nullish(),
  year: z.number().int().min(1878).max(2100).nullish(),
  format: filmFormatSchema,
  audio: z.string().trim().max(500).nullish(),
  hdr: z.string().trim().max(100).nullish(),
  region: z.string().trim().max(50).nullish(),
  label: z.string().trim().max(200).nullish(),
  edition: z.string().trim().max(500).nullish(),
  packageType: z.string().trim().max(100).nullish(),
  spineNumber: z.number().int().min(1).max(100000).nullish(),
  runtimeMinutes: z.number().int().min(1).max(10000).nullish(),
  discCount: z.number().int().min(1).max(200).default(1),
  barcode: z.string().trim().max(100).nullish(),
  coverUrl: z.string().trim().url().max(2048).nullish().or(z.literal("")),
  notes: z.string().trim().max(5000).nullish(),
  pricePaid: z.number().min(0).max(99_999_999).nullish(),
  /**
   * Manual TMDB id — wins over the title search when set. Movie and TV ids
   * are separate namespaces on TMDB (tv/60573 is Silicon Valley while
   * movie/60573 is The Burning Bed), so an explicit media type disambiguates;
   * without one, movie is tried first, then TV.
   */
  tmdbId: z.number().int().positive().nullish(),
  tmdbMediaType: z.enum(["movie", "tv"]).nullish(),
})

const emptyToNull = (v: string | null | undefined) =>
  v == null || v === "" ? null : v

function toRow(data: z.infer<typeof filmInput>) {
  return {
    title: data.title,
    sortTitle: toSortTitle(data.title),
    director: emptyToNull(data.director),
    year: data.year ?? null,
    format: data.format,
    audio: emptyToNull(data.audio),
    hdr: emptyToNull(data.hdr),
    region: emptyToNull(data.region),
    label: emptyToNull(data.label),
    edition: emptyToNull(data.edition),
    packageType: emptyToNull(data.packageType),
    spineNumber: data.spineNumber ?? null,
    runtimeMinutes: data.runtimeMinutes ?? null,
    discCount: data.discCount,
    barcode: emptyToNull(data.barcode),
    coverUrl: emptyToNull(data.coverUrl),
    notes: emptyToNull(data.notes),
    // numeric column — drizzle takes/returns strings for exact decimals.
    pricePaid: data.pricePaid != null ? data.pricePaid.toFixed(2) : null,
  }
}

export const listFilmsFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    return withUser(context.userId, (tx) =>
      tx.select().from(films).orderBy(asc(films.sortTitle), asc(films.year))
    )
  })

export const getFilmFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ context, data }) => {
    const rows = await withUser(context.userId, (tx) =>
      tx.select().from(films).where(eq(films.id, data.id)).limit(1)
    )
    return rows.at(0) ?? null
  })

export const createFilmFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(filmInput)
  .handler(async ({ context, data }) => {
    // Best-effort enrichment; misses never block the add.
    const [tmdb, rt] = await Promise.all([
      data.tmdbId
        ? fetchTmdbById(data.tmdbId, data.tmdbMediaType)
        : fetchTmdbCast(data.title, data.year ?? null),
      fetchRtScores(data.title, data.year ?? null, null).catch(() => null),
    ])
    const row = toRow(data)
    if (row.spineNumber == null && isCriterionLabel(row.label)) {
      row.spineNumber = await lookupSpine(data.title, data.year ?? null)
    }
    // TMDB fills whatever the disc source didn't know.
    if (tmdb) {
      row.director ??= tmdb.directors.join(", ") || null
      row.coverUrl ??= tmdb.posterUrl
    }
    const rows = await withUser(context.userId, (tx) =>
      tx
        .insert(films)
        .values({
          userId: context.userId,
          ...row,
          ...(tmdb && {
            tmdbId: tmdb.tmdbId,
            tmdbMediaType: tmdb.mediaType,
            tmdbCast: tmdb.cast,
            tmdbDetails: tmdb.details,
          }),
          // A miss stays unsynced so the settings backfill retries it.
          ...(rt && {
            rtUrl: rt.url,
            rtCriticsScore: rt.criticsScore,
            rtAudienceScore: rt.audienceScore,
            rtSyncedAt: new Date(),
          }),
        })
        .returning()
    )
    return rows[0]
  })

export const updateFilmFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(filmInput.extend({ id: z.string().uuid() }))
  .handler(async ({ context, data }) => {
    const { id, ...rest } = data

    // A changed manual TMDB reference (id or media type) re-pulls cast +
    // details from that title. An empty field leaves the existing match alone.
    let tmdbPatch = {}
    if (rest.tmdbId != null) {
      const existing = (
        await withUser(context.userId, (tx) =>
          tx
            .select({
              tmdbId: films.tmdbId,
              tmdbMediaType: films.tmdbMediaType,
            })
            .from(films)
            .where(eq(films.id, id))
            .limit(1),
        )
      ).at(0)
      const changed =
        existing?.tmdbId !== rest.tmdbId ||
        (rest.tmdbMediaType != null &&
          existing.tmdbMediaType !== rest.tmdbMediaType)
      if (changed) {
        const tmdb = await fetchTmdbById(rest.tmdbId, rest.tmdbMediaType)
        if (!tmdb) {
          return {
            error: `TMDB has no ${rest.tmdbMediaType ?? "movie or TV"} title with id ${rest.tmdbId}.` as const,
          }
        }
        tmdbPatch = {
          tmdbId: tmdb.tmdbId,
          tmdbMediaType: tmdb.mediaType,
          tmdbCast: tmdb.cast,
          tmdbDetails: tmdb.details,
        }
      }
    }

    const rows = await withUser(context.userId, (tx) =>
      tx
        .update(films)
        .set({ ...toRow(rest), ...tmdbPatch, updatedAt: new Date() })
        .where(eq(films.id, id))
        .returning()
    )
    return rows.at(0) ?? null
  })

export const deleteFilmFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ context, data }) => {
    await withUser(context.userId, (tx) =>
      tx.delete(films).where(eq(films.id, data.id))
    )
    return { ok: true }
  })

/**
 * Manual watched override: true/false pins the state; null clears the
 * override so the Letterboxd sync value applies again.
 */
export const setWatchedOverrideFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({ id: z.string().uuid(), watched: z.boolean().nullable() })
  )
  .handler(async ({ context, data }) => {
    const rows = await withUser(context.userId, (tx) =>
      tx
        .update(films)
        .set({ watchedOverride: data.watched, updatedAt: new Date() })
        .where(eq(films.id, data.id))
        .returning()
    )
    return rows.at(0) ?? null
  })
