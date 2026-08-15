import type { Film } from "@/db/schema"
import { isWatched } from "@/lib/film-helpers"

/**
 * Film-field projection — the one answer to "what is this field's value on
 * this film" and "what distinct values does the collection hold, with
 * counts". Shelf rules, collection filters and the statistics tallies all
 * read from here, so a film with no HDR recorded counts as SDR on every
 * page and adding a field is a single edit to the table below.
 *
 * A field yields a list, not a value: a film carries several genres, and an
 * unrecorded field carries none at all (so it never becomes a filter option
 * or a shelf-rule value).
 */

export interface FilmFieldDef {
  /** Stored on shelf rules and used as the collection page's URL param. */
  field: string
  /** Shown in the shelf builder's field picker and the filter panel. */
  label: string
  valuesOf: (film: Film) => string[]
}

/** What a title can be. Closed, unlike publisher or edition. */
export const MEDIA_TYPES = ["Movie", "TV"] as const

export const FILM_FIELDS = [
  { field: "format", label: "Format", valuesOf: (f: Film) => [f.format] },
  {
    field: "mediaType",
    label: "Type",
    // Unmatched titles count as movies — physical shelves are mostly films.
    valuesOf: (f: Film) => [f.tmdbMediaType === "tv" ? "TV" : "Movie"],
  },
  {
    field: "label",
    label: "Publisher",
    valuesOf: (f: Film) => (f.label ? [f.label] : []),
  },
  {
    field: "edition",
    label: "Edition",
    valuesOf: (f: Film) => (f.edition ? [f.edition] : []),
  },
  {
    field: "packageType",
    label: "Package",
    valuesOf: (f: Film) => (f.packageType ? [f.packageType] : []),
  },
  {
    field: "hdr",
    label: "HDR",
    // No dynamic range recorded means standard dynamic range.
    valuesOf: (f: Film) => [f.hdr ?? "SDR"],
  },
  {
    field: "region",
    label: "Region",
    valuesOf: (f: Film) => (f.region ? [f.region] : []),
  },
  {
    field: "decade",
    label: "Decade",
    valuesOf: (f: Film) =>
      f.year != null ? [`${Math.floor(f.year / 10) * 10}s`] : [],
  },
  {
    field: "watched",
    label: "Watched",
    valuesOf: (f: Film) => [isWatched(f) ? "Watched" : "Unwatched"],
  },
  {
    field: "genre",
    label: "Genre",
    valuesOf: (f: Film) => f.tmdbDetails?.genres ?? [],
  },
  {
    field: "tmdb",
    label: "TMDB",
    valuesOf: (f: Film) => [f.tmdbId != null ? "Matched" : "No match"],
  },
] as const satisfies readonly FilmFieldDef[]

/** A film field a shelf rule can test and the collection page can filter. */
export type FilmField = (typeof FILM_FIELDS)[number]["field"]

/** Every field name — the set a stored shelf rule is validated against. */
export const FILM_FIELD_KEYS = FILM_FIELDS.map(({ field }) => field)

const BY_FIELD = new Map<FilmField, FilmFieldDef>(
  FILM_FIELDS.map((def) => [def.field, def])
)

/**
 * Every value this film has for the field; empty when it has none. A blank
 * string is no value, so it never becomes a filter option or a rule value.
 */
export function filmFieldValues(film: Film, field: FilmField): string[] {
  return BY_FIELD.get(field)!
    .valuesOf(film)
    .filter((value) => value !== "")
}

/**
 * The distinct values the collection holds for a field, with how many films
 * hold each. Rule and filter pickers want them by value (numerically aware,
 * so 1990s precedes 2020s); the statistics tallies want the biggest first.
 */
export function filmFieldOptions(
  films: Film[],
  field: FilmField,
  order: "value" | "count" = "value"
): Array<[string, number]> {
  const counts = new Map<string, number>()
  for (const film of films) {
    for (const value of filmFieldValues(film, field)) {
      counts.set(value, (counts.get(value) ?? 0) + 1)
    }
  }
  const byValue = (a: string, b: string) =>
    a.localeCompare(b, undefined, { numeric: true })
  return [...counts.entries()].sort((a, b) =>
    order === "count" ? b[1] - a[1] || byValue(a[0], b[0]) : byValue(a[0], b[0])
  )
}

/** Every field's options at once — what a rule or filter picker renders. */
export function filmFieldOptionsByField(
  films: Film[]
): Record<FilmField, Array<[string, number]>> {
  const result = {} as Record<FilmField, Array<[string, number]>>
  for (const { field } of FILM_FIELDS) {
    result[field] = filmFieldOptions(films, field)
  }
  return result
}
