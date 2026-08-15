import type { CastMember, Film, TmdbDetails } from "@/db/schema"

/**
 * What fetched metadata does to a film. Every write path — adding a film,
 * syncing cast, syncing details, rematching an identifier, moving a wishlist
 * item into the collection — merges here, so the rules are written once:
 *
 * - A blank column is filled from whichever source knows it.
 * - A column the user set is never overwritten.
 * - The disc source describes the copy on the shelf, so it wins over the
 *   metadata source wherever both know a column.
 * - A lookup that ran is recorded as attempted, matched or not, so a later
 *   sweep can tell "never tried" from "tried and found nothing".
 * - Columns only a source writes — the TMDB match, the review scores — are
 *   replaced by what that source last returned.
 *
 * Fetching stays outside: the merge takes what the sources returned and
 * returns the columns to write, so it needs no network and no database.
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

/** The film values a merge reads. */
export type EnrichableFilm = Partial<Pick<Film, FillableField>>

/** What the disc source (Blu-ray.com, CEX) knows about the physical copy. */
export type DiscEnrichment = Partial<Pick<Film, FillableField>>

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
  spineNumber?: number | null
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

export interface MergeOptions {
  /** The clock, injected so a merge is reproducible in tests. */
  now?: Date
}

/** A stored value counts as blank when nothing meaningful is in it. */
function isBlank(value: unknown): boolean {
  return value == null || (typeof value === "string" && value.trim() === "")
}

/** Write one fillable column, keeping its own column type. */
function fill<TField extends FillableField>(
  patch: FilmEnrichmentPatch,
  field: TField,
  value: Film[TField]
) {
  patch[field] = value
}

/** The metadata source, expressed as the columns it can fill. */
function metadataFill(tmdb: TmdbEnrichment | null | undefined): DiscEnrichment {
  if (!tmdb) return {}
  return {
    director: tmdb.directors.join(", ") || null,
    coverUrl: tmdb.posterUrl ?? null,
  }
}

/**
 * Decide what fetched metadata does to a film: given the film and what the
 * sources returned, produce the columns to write. No fetching happens here.
 *
 * The disc source describes the copy on the shelf, so it wins over the
 * metadata source wherever both know a field.
 */
export function mergeEnrichment(
  film: EnrichableFilm,
  sources: EnrichmentSources,
  options: MergeOptions = {}
): FilmEnrichmentPatch {
  const patch: FilmEnrichmentPatch = {}
  const offers = [
    sources.disc ?? {},
    metadataFill(sources.tmdb),
    { spineNumber: sources.spineNumber },
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
    patch.rtSyncedAt = options.now ?? new Date()
  }

  return patch
}
