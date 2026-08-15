import type { CastMember, Film, TmdbDetails } from "@/db/schema"

/**
 * What fetched metadata does to a film. The rules are written once here:
 *
 * - A blank field is filled from whichever source knows it.
 * - A field the user set is never overwritten.
 * - The disc source describes the copy on the shelf. It thus wins over the
 *   metadata source wherever both know a field.
 * - A lookup that ran is recorded as attempted, matched or not. A later
 *   sweep can then tell "never tried" from "tried and found nothing". Only
 *   the review scores have a field for this record.
 * - Fields that only a source writes — the TMDB match, the review scores —
 *   are replaced by what that source last returned.
 *
 * Fetching stays outside. The merge takes what the sources returned and
 * gives back the fields to write. It thus needs no network and no database.
 *
 * The review-score sync and refresh merge here today. The remaining write
 * paths — adding a film, syncing cast, syncing details, rematching an
 * identifier, moving a wishlist item into the collection — follow.
 */

/**
 * Every field a source may fill. A source fills one of these only when the
 * film leaves it blank, so a value the user typed is never overwritten.
 * A new fillable field is one edit to this list.
 *
 * Format and disc count are absent on purpose. Both are NOT NULL with a
 * default, so they have no blank state for a source to fill. They reach a
 * film through the add form, where the user sees them before they are saved.
 */
const FILLABLE_FIELDS = [
  "director",
  "year",
  "coverUrl",
  "runtimeMinutes",
  "spineNumber",
  "label",
  "edition",
  "packageType",
  "audio",
  "hdr",
  "region",
  "barcode",
] as const

type FillableField = (typeof FILLABLE_FIELDS)[number]

/** Some of the fields a source may fill. */
type FillableFields = Partial<Pick<Film, FillableField>>

/**
 * What the merge reads off the film. Every fillable field is required. A
 * query that selects only some of them makes the fields it left out look
 * blank, and the merge would then overwrite a value the user set.
 */
export type EnrichableFilm = Pick<Film, FillableField>

/** What the disc source (Blu-ray.com, CEX) knows about the physical copy. */
export type DiscEnrichment = FillableFields

/** What the metadata source (TMDB) returned for one film. */
export interface TmdbEnrichment {
  tmdbId: number
  mediaType: "movie" | "tv"
  /** Director name(s) — movies only; TV series direct per-episode. */
  directors: string[]
  posterUrl?: string | null
  cast?: CastMember[]
  details?: TmdbDetails | null
}

/**
 * What the review-score source (Rotten Tomatoes) returned for one film.
 * `src/server/rottentomatoes.ts` returns this shape as `RtResult`.
 */
export interface RtEnrichment {
  url: string
  criticsScore: number | null
  audienceScore: number | null
}

/**
 * What each source returned for one film. A key left out means the source
 * was never asked; a key set to null means it was asked and matched nothing,
 * which is still an attempt and is recorded as one.
 */
export interface EnrichmentSources {
  disc?: DiscEnrichment | null
  tmdb?: TmdbEnrichment | null
  rt?: RtEnrichment | null
  /** What the Criterion spine lookup returned. */
  criterionSpine?: number | null
}

/** The fields an enrichment run writes back to the film. */
export type FilmEnrichmentPatch = Partial<
  Pick<
    Film,
    | FillableField
    | "tmdbId"
    | "tmdbMediaType"
    | "tmdbCast"
    | "tmdbDetails"
    | "rtUrl"
    | "rtCriticsScore"
    | "rtAudienceScore"
    | "rtSyncedAt"
  >
>

/** A stored value is blank when it is absent, or is spaces only. */
function isBlank(value: unknown): boolean {
  return value == null || (typeof value === "string" && value.trim() === "")
}

/**
 * Write one fillable field, named by a value the loop holds. The type
 * parameter permits the write. It does not check the value against that one
 * field. Pass only a value that the offer for that field carried.
 */
function fill<TField extends FillableField>(
  patch: FilmEnrichmentPatch,
  field: TField,
  value: Film[TField]
) {
  patch[field] = value
}

/** The TMDB match, expressed as the fields it can fill. */
function tmdbFillableFields(
  tmdb: TmdbEnrichment | null | undefined
): FillableFields {
  if (!tmdb) return {}
  return {
    director: tmdb.directors.join(", ") || null,
    coverUrl: tmdb.posterUrl ?? null,
  }
}

/**
 * Decide what fetched metadata does to a film. Take the film and what the
 * sources returned, and give back the fields to write. No fetching happens
 * here. `now` is a parameter, so that a merge is reproducible in tests.
 */
export function mergeEnrichment(
  film: EnrichableFilm,
  sources: EnrichmentSources,
  now: Date = new Date()
): FilmEnrichmentPatch {
  const patch: FilmEnrichmentPatch = {}
  const offers = [
    sources.disc ?? {},
    tmdbFillableFields(sources.tmdb),
    { spineNumber: sources.criterionSpine },
  ]

  for (const field of FILLABLE_FIELDS) {
    if (!isBlank(film[field])) continue
    const offered = offers.find((offer) => !isBlank(offer[field]))?.[field]
    if (offered != null) fill(patch, field, offered)
  }

  // Nothing but the source writes the match, so a new match replaces the
  // stored one. Details are the exception. A match that carries none must
  // not erase the details that an earlier run stored.
  if (sources.tmdb) {
    patch.tmdbId = sources.tmdb.tmdbId
    patch.tmdbMediaType = sources.tmdb.mediaType
    if (sources.tmdb.cast) patch.tmdbCast = sources.tmdb.cast
    if (sources.tmdb.details) patch.tmdbDetails = sources.tmdb.details
  }

  // The scores belong to the source, not to the user. A lookup that ran
  // thus replaces them. A miss clears scores that no longer hold.
  if (sources.rt !== undefined) {
    patch.rtUrl = sources.rt?.url ?? null
    patch.rtCriticsScore = sources.rt?.criticsScore ?? null
    patch.rtAudienceScore = sources.rt?.audienceScore ?? null
    patch.rtSyncedAt = now
  }

  return patch
}
