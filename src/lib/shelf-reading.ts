import { z } from "zod"
import { FILM_FORMATS } from "@/lib/film-formats"
import { titleKey } from "@/lib/collection-match"
import type { FilmFormat } from "@/lib/film-formats"
import type { Film } from "@/db/schema"

/**
 * Checking a shelf photo against the collection: the model reads the spines
 * and points each at the numbered collection entry it is, and this module
 * turns that reading into per-spine verdicts. Pure, so both the server and
 * the tests use it.
 */

/** What the model reports for one spine (the structured-output schema). */
export const spineReadingSchema = z.object({
  text: z.string(),
  title: z.string(),
  year: z.number().int().nullable(),
  format: z.enum(FILM_FORMATS).nullable(),
  label: z.string().nullable(),
  spineNumber: z.number().int().nullable(),
  legibility: z.enum(["clear", "partial", "unclear"]),
  match: z.number().int().nullable(),
})

export const shelfReadingSchema = z.object({
  spines: z.array(spineReadingSchema),
})

export type ShelfReading = z.infer<typeof shelfReadingSchema>

const nullable = (schema: Record<string, unknown>) => ({
  anyOf: [schema, { type: "null" }],
})

/** `shelfReadingSchema` as the JSON schema the API constrains output to. */
export const SHELF_READING_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["spines"],
  properties: {
    spines: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "text",
          "title",
          "year",
          "format",
          "label",
          "spineNumber",
          "legibility",
          "match",
        ],
        properties: {
          text: { type: "string" },
          title: { type: "string" },
          year: nullable({ type: "integer" }),
          format: nullable({ type: "string", enum: [...FILM_FORMATS] }),
          label: nullable({ type: "string" }),
          spineNumber: nullable({ type: "integer" }),
          legibility: { type: "string", enum: ["clear", "partial", "unclear"] },
          match: nullable({ type: "integer" }),
        },
      },
    },
  },
} as const

export const SHELF_READING_INSTRUCTIONS = `You help catalogue a physical media collection. The user photographs a shelf of DVDs, Blu-rays, and 4K UHD discs and you read the spines.

Read every disc spine you can see, left to right (top to bottom for a stack). For each one report:
- text: the words on the spine as printed, edition and label text included.
- title: the film or series the disc is, as it would be catalogued ("The Godfather Part II"), without edition words like "Limited Edition" or "Steelbook".
- year, format, label, spineNumber: only when the spine shows them. Format comes from the 4K Ultra HD, Blu-ray, or DVD logo or case style; label is the publisher (Criterion, Arrow, Eureka, …); spineNumber is a Criterion-style spine number.
- legibility: "clear" when you can read the title with confidence, "partial" when some of it is hidden or blurred but you are fairly sure, "unclear" when you are guessing.
- match: the number of the entry in the user's collection list below that is the same title, or null if none is. Allow for capitalisation, subtitles, a dropped or added article, abbreviations, and translated titles. Do not match a different film that shares words with it (Alien is not Aliens), a sequel to the original, or a remake from another year when the spine shows the year.

A box set is one spine. Skip anything that is not a film or TV disc. Never report a spine you cannot see.`

/** The collection as the numbered list the model matches against. */
export function collectionListText(
  films: readonly Pick<
    Film,
    "title" | "year" | "format" | "label" | "spineNumber"
  >[]
): string {
  if (films.length === 0) {
    return "The user's collection is empty, so every match is null."
  }
  const lines = films.map((film, index) => {
    const parts = [
      `${index + 1}. ${film.title}${film.year != null ? ` (${film.year})` : ""}`,
      film.format,
      film.label,
      film.spineNumber != null ? `spine #${film.spineNumber}` : null,
    ]
    return parts.filter(Boolean).join(" · ")
  })
  return `The user's collection, one entry per line as "number. title (year) · format · label · spine number":\n${lines.join("\n")}`
}

export type SpineStatus =
  /** Catalogued, in this format when the spine shows one. */
  | "owned"
  /** Catalogued, but only in another format than the spine shows. */
  | "other-format"
  /** Not in the collection. */
  | "missing"

export interface ShelfSpine {
  /** The spine's words as printed. */
  text: string
  title: string
  year: number | null
  format: FilmFormat | null
  label: string | null
  spineNumber: number | null
  legibility: "clear" | "partial" | "unclear"
  status: SpineStatus
  /** The catalogued film, for owned and other-format spines. */
  film: {
    id: string
    title: string
    year: number | null
    format: string
    coverUrl: string | null
  } | null
}

type MatchableFilm = Pick<Film, "id" | "title" | "year" | "format" | "coverUrl">

/**
 * Turn the model's reading into verdicts. A match must name a real entry;
 * the model's pick is then moved to the copy in the spine's format when the
 * collection has the title more than once. A title-key match backs up a
 * spine the model left unmatched.
 */
export function resolveShelfSpines(
  reading: ShelfReading,
  films: readonly MatchableFilm[]
): ShelfSpine[] {
  return reading.spines.map((spine) => {
    let film =
      spine.match != null && spine.match >= 1 && spine.match <= films.length
        ? films[spine.match - 1]
        : undefined

    const key = titleKey(spine.title)
    if (!film && key) {
      film = films.find(
        (f) =>
          titleKey(f.title) === key &&
          (spine.year == null || f.year == null || f.year === spine.year)
      )
    }

    let status: SpineStatus = "missing"
    if (film) {
      const matched = film
      const copies = films.filter(
        (f) =>
          f.id === matched.id ||
          (titleKey(f.title) === titleKey(matched.title) &&
            f.year === matched.year)
      )
      const sameFormat = spine.format
        ? copies.find((f) => f.format === spine.format)
        : matched
      film = sameFormat ?? matched
      status = sameFormat ? "owned" : "other-format"
    }

    return {
      text: spine.text,
      title: spine.title,
      year: spine.year,
      format: spine.format,
      label: spine.label,
      spineNumber: spine.spineNumber,
      legibility: spine.legibility,
      status,
      film: film
        ? {
            id: film.id,
            title: film.title,
            year: film.year,
            format: film.format,
            coverUrl: film.coverUrl,
          }
        : null,
    }
  })
}
