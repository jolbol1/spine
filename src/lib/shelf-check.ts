import { z } from "zod"
import { findDuplicates, titleKey } from "@/lib/collection-match"
import { FILM_FORMATS } from "@/lib/film-formats"
import type { ShelfSpine } from "@/lib/shelf-reading"
import type { Film } from "@/db/schema"

/**
 * Shelf check on the client: the spines read from several photos merged
 * into one list, then sorted into what's missing from the collection, what
 * it has in another format, and what's already catalogued. Pure, so it's
 * unit-tested; the page and its session store use it.
 */

const LEGIBILITY_RANK: Record<ShelfSpine["legibility"], number> = {
  clear: 0,
  partial: 1,
  unclear: 2,
}

/**
 * The same spine seen twice — in overlapping photos of one shelf — shares
 * this key. Unreadable titles get none, so they're never merged.
 */
export function spineKey(
  spine: Pick<ShelfSpine, "title" | "format" | "year">
): string | null {
  const key = titleKey(spine.title)
  return key ? `${key}|${spine.format ?? ""}|${spine.year ?? ""}` : null
}

/**
 * Every photo's spines as one list in reading order, each spine once. When
 * overlapping photos both show a spine, the clearer reading wins and the
 * other fills in any label or spine number it lacked.
 */
export function mergeShelfSpines(
  photos: ReadonlyArray<ReadonlyArray<ShelfSpine>>
): Array<ShelfSpine> {
  const merged: Array<ShelfSpine> = []
  const indexByKey = new Map<string, number>()
  for (const spines of photos) {
    for (const spine of spines) {
      const key = spineKey(spine)
      const index = key == null ? undefined : indexByKey.get(key)
      if (key == null || index === undefined) {
        if (key != null) indexByKey.set(key, merged.length)
        merged.push(spine)
        continue
      }
      const kept = merged[index]
      const [best, other] =
        LEGIBILITY_RANK[spine.legibility] < LEGIBILITY_RANK[kept.legibility]
          ? [spine, kept]
          : [kept, spine]
      merged[index] = {
        ...best,
        label: best.label ?? other.label,
        spineNumber: best.spineNumber ?? other.spineNumber,
        film: best.film ?? other.film,
        status: best.film ? best.status : other.status,
      }
    }
  }
  return merged
}

/**
 * Every photo's spines in order, as the shelf order check wants them. The
 * check drops a catalogued disc seen again in an overlapping photo itself;
 * an uncatalogued one has no id to go by, so a spine the previous photo
 * also showed is dropped here. Within one photo, repeats are kept — they
 * may be two copies side by side.
 */
export function joinShelfPhotos(
  photos: ReadonlyArray<ReadonlyArray<ShelfSpine>>
): Array<ShelfSpine> {
  const uncatalogued = (spine: ShelfSpine) =>
    spine.status !== "owned" || spine.film == null
  return photos.flatMap((spines, index) => {
    if (index === 0) return [...spines]
    const previous = new Set(
      photos[index - 1].filter(uncatalogued).map(spineKey)
    )
    return spines.filter((spine) => {
      if (!uncatalogued(spine)) return true
      const key = spineKey(spine)
      return key == null || !previous.has(key)
    })
  })
}

export interface ShelfCheckEntry {
  /** Unique within its section. */
  key: string
  spine: ShelfSpine
  /**
   * For a spine read as missing or in another format: the copy catalogued
   * since the photo was read, so the list shows what's been dealt with.
   */
  added: Film | null
}

export interface ShelfCheckSections {
  missing: Array<ShelfCheckEntry>
  otherFormat: Array<ShelfCheckEntry>
  owned: Array<ShelfCheckEntry>
}

/**
 * For a spine read as missing or in another format: the copy catalogued
 * since the photo was read. The server judged each spine when the photo was
 * read; a title added since then is found again here with
 * `findDuplicates`, so it shows as added without reading the photo again.
 */
export function addedSince(
  spine: ShelfSpine,
  films: ReadonlyArray<Film>
): Film | null {
  if (spine.status === "owned") return null
  const matches = findDuplicates(films, {
    title: spine.title,
    year: spine.year,
    format: spine.format,
  })
  // Read as missing, there was no copy at all then — any copy now is new.
  // In another format, only a copy in the spine's format is.
  const added =
    spine.status === "missing"
      ? matches.at(0)
      : matches.find((m) => m.reason === "same-format")
  return added?.film ?? null
}

/** Sort the spines into sections against the collection as it is now. */
export function shelfCheckSections(
  spines: ReadonlyArray<ShelfSpine>,
  films: ReadonlyArray<Film>
): ShelfCheckSections {
  const sections: ShelfCheckSections = {
    missing: [],
    otherFormat: [],
    owned: [],
  }
  spines.forEach((spine, index) => {
    const entry = {
      key: `${index}:${spine.title}`,
      spine,
      added: addedSince(spine, films),
    }
    if (spine.status === "owned") sections.owned.push(entry)
    else if (spine.status === "missing") sections.missing.push(entry)
    else sections.otherFormat.push(entry)
  })
  return sections
}

// ---- Session storage -----------------------------------------------------

const spineFilmSchema = z.object({
  id: z.string(),
  title: z.string(),
  year: z.number().nullable(),
  format: z.string(),
  coverUrl: z.string().nullable(),
})

const shelfSpineSchema = z.object({
  text: z.string(),
  title: z.string(),
  year: z.number().nullable(),
  format: z.enum(FILM_FORMATS).nullable(),
  label: z.string().nullable(),
  spineNumber: z.number().nullable(),
  legibility: z.enum(["clear", "partial", "unclear"]),
  status: z.enum(["owned", "other-format", "missing"]),
  film: spineFilmSchema.nullable(),
})

const storedPhotoSchema = z.object({
  id: z.string(),
  name: z.string(),
  thumbnail: z.string().nullable(),
  result: z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true), spines: z.array(shelfSpineSchema) }),
    z.object({ ok: z.literal(false), error: z.string() }),
  ]),
})

const storedShelfCheckSchema = z.object({
  photos: z.array(storedPhotoSchema),
})

/** A photo that has been read (or failed), as kept in session storage. */
export type StoredShelfPhoto = z.infer<typeof storedPhotoSchema>

export function serializeShelfCheck(
  photos: ReadonlyArray<StoredShelfPhoto>
): string {
  return JSON.stringify({ photos })
}

/** The stored photos, or none when the value is missing or malformed. */
export function parseShelfCheck(raw: string | null): Array<StoredShelfPhoto> {
  if (!raw) return []
  try {
    const parsed = storedShelfCheckSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data.photos : []
  } catch {
    return []
  }
}
