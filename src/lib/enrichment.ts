import type { CastMember, Film, TmdbDetails } from "@/db/schema"

/**
 * What fetched metadata does to a film. The rules are written once here:
 *
 * - A blank column is filled from whichever source knows it.
 * - A column the user set is never overwritten.
 * - The disc source describes the copy on the shelf, so it wins over the
 *   metadata source wherever both know a column.
 * - A lookup that ran is recorded as attempted, matched or not, so a later
 *   sweep can tell "never tried" from "tried and found nothing". Only the
 *   review scores have a column for this, so only they record it.
 * - Columns only a source writes — the TMDB match, the review scores — are
 *   replaced by what that source last returned.
 *
 * Fetching stays outside: the merge takes what the sources returned and
 * returns the columns to write, so it needs no network and no database.
 *
 * The review-score sync and refresh merge here today. The remaining write
 * paths — adding a film, syncing cast, syncing details, rematching an
 * identifier, moving a wishlist item into the collection — follow.
 */

/**
 * Every column a source may fill. A source fills one of these only when the
 * film leaves it blank, so a value the user typed is never overwritten.
 * Adding a fillable column is one edit here.
 *
 * Format and disc count are absent on purpose: both are NOT NULL with a
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

/** Some of the columns a source may fill. */
type FillableColumns = Partial<Pick<Film, FillableField>>

/**
 * What the merge reads off the film. Every fillable column is required: a
 * query that selects only some of them makes the columns it left out look
 * blank, and the merge would then overwrite a value the user set.
 */
export type EnrichableFilm = Pick<Film, FillableField>

/** What the disc source (Blu-ray.com, CEX) knows about the physical copy. */
export type DiscEnrichment = FillableColumns

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

/** What the review-score source (Rotten Tomatoes) returned for one film. */
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

/** The columns an enrichment run writes back to the film. */
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

/** A stored value counts as blank when nothing meaningful is in it. */
function isBlank(value: unknown): boolean {
  return value == null || (typeof value === "string" && value.trim() === "")
}

/**
 * Write one fillable column. The type parameter is what lets the column be
 * written through a name the loop holds; it does not check the value against
 * that one column, so pass a value the offer itself carried.
 */
function fill<TField extends FillableField>(
  patch: FilmEnrichmentPatch,
  field: TField,
  value: Film[TField]
) {
  patch[field] = value
}

/** The metadata source, expressed as the columns it can fill. */
function metadataFill(
  tmdb: TmdbEnrichment | null | undefined
): FillableColumns {
  if (!tmdb) return {}
  return {
    director: tmdb.directors.join(", ") || null,
    coverUrl: tmdb.posterUrl ?? null,
  }
}

/**
 * Decide what fetched metadata does to a film: given the film and what the
 * sources returned, produce the columns to write. No fetching happens here.
 * `now` is a parameter so a merge is reproducible in tests.
 */
export function mergeEnrichment(
  film: EnrichableFilm,
  sources: EnrichmentSources,
  now: Date = new Date()
): FilmEnrichmentPatch {
  const patch: FilmEnrichmentPatch = {}
  const offers = [
    sources.disc ?? {},
    metadataFill(sources.tmdb),
    { spineNumber: sources.criterionSpine },
  ]

  for (const field of FILLABLE_FIELDS) {
    if (!isBlank(film[field])) continue
    const offered = offers.find((offer) => !isBlank(offer[field]))?.[field]
    if (offered != null) fill(patch, field, offered)
  }

  // The match itself is the source's to own — nothing else writes these —
  // so a fresh match replaces the stored one. Details are the exception:
  // a match carrying none must not erase details an earlier run stored.
  if (sources.tmdb) {
    patch.tmdbId = sources.tmdb.tmdbId
    patch.tmdbMediaType = sources.tmdb.mediaType
    if (sources.tmdb.cast) patch.tmdbCast = sources.tmdb.cast
    if (sources.tmdb.details) patch.tmdbDetails = sources.tmdb.details
  }

  // Scores belong to the source, not to the user, so a lookup that ran
  // replaces them outright — a miss clears scores that no longer hold.
  if (sources.rt !== undefined) {
    patch.rtUrl = sources.rt?.url ?? null
    patch.rtCriticsScore = sources.rt?.criticsScore ?? null
    patch.rtAudienceScore = sources.rt?.audienceScore ?? null
    patch.rtSyncedAt = now
  }

  return patch
}
