import type {
  Film,
  Shelf,
  ShelfRule,
  ShelfRuleField,
  ShelfSortKey,
  ShelfSortLevel,
  WishlistItem,
} from "@/db/schema"
import { isWatched, toSortTitle } from "@/lib/film-helpers"

/**
 * Shelves are an ordered partition of the collection: every film lives on
 * exactly one shelf — the first one (top to bottom) it matches — so shelf
 * order doubles as rule precedence. A boutique shelf above the format
 * shelves claims its Criterion 4Ks before the 4K shelf can.
 */

export const SHELF_RULE_FIELDS: Array<{
  field: ShelfRuleField
  label: string
}> = [
  { field: "format", label: "Format" },
  { field: "mediaType", label: "Type" },
  { field: "label", label: "Publisher" },
  { field: "edition", label: "Edition" },
  { field: "packageType", label: "Package" },
  { field: "hdr", label: "HDR" },
  { field: "region", label: "Region" },
  { field: "decade", label: "Decade" },
  { field: "watched", label: "Watched" },
  { field: "genre", label: "Genre" },
]

export const SHELF_SORT_KEYS: Array<{ key: ShelfSortKey; label: string }> = [
  { key: "title", label: "Title" },
  { key: "spine", label: "Criterion spine #" },
  { key: "year", label: "Release year" },
  { key: "added", label: "Date added" },
  { key: "publisher", label: "Publisher" },
  { key: "runtime", label: "Runtime" },
]

const DEFAULT_SORT: ShelfSortLevel[] = [{ key: "title" }]

/** Default direction per key — "added" reads newest-first like the app. */
const DEFAULT_SORT_DIR: Record<ShelfSortKey, "asc" | "desc"> = {
  title: "asc",
  spine: "asc",
  year: "asc",
  added: "desc",
  publisher: "asc",
  runtime: "asc",
}

/**
 * A film's value for a rule field. Genres return every genre; unmatched
 * titles count as movies (physical shelves are mostly films) and missing
 * HDR means SDR, both consistent with the collection page filters.
 */
export function shelfFieldValues(film: Film, field: ShelfRuleField): string[] {
  switch (field) {
    case "format":
      return [film.format]
    case "mediaType":
      return [film.tmdbMediaType === "tv" ? "TV" : "Movie"]
    case "label":
      return film.label ? [film.label] : []
    case "edition":
      return film.edition ? [film.edition] : []
    case "packageType":
      return film.packageType ? [film.packageType] : []
    case "hdr":
      return [film.hdr ?? "SDR"]
    case "region":
      return film.region ? [film.region] : []
    case "decade":
      return film.year != null ? [`${Math.floor(film.year / 10) * 10}s`] : []
    case "watched":
      return [isWatched(film) ? "Watched" : "Unwatched"]
    case "genre":
      return film.tmdbDetails?.genres ?? []
  }
}

/** Rules with no values are builder drafts — they match everything. */
const ruleMatches = (film: Film, rule: ShelfRule): boolean =>
  rule.values.length === 0 ||
  shelfFieldValues(film, rule.field).some((v) => rule.values.includes(v))

/** Rules only — ignores pins and exclusions. */
export function matchesShelfRules(film: Film, shelf: Shelf): boolean {
  return shelf.rules.every((rule) => ruleMatches(film, rule))
}

const time = (value: Date | string) => new Date(value).getTime()

/** Multi-level comparator; films missing a value sink below either dir. */
function compareBySort(a: Film, b: Film, levels: ShelfSortLevel[]): number {
  for (const level of levels) {
    const dir = level.dir ?? DEFAULT_SORT_DIR[level.key]
    const sign = dir === "desc" ? -1 : 1
    let av: number | string | null
    let bv: number | string | null
    switch (level.key) {
      case "title":
        av = a.sortTitle
        bv = b.sortTitle
        break
      case "spine":
        av = a.spineNumber
        bv = b.spineNumber
        break
      case "year":
        av = a.year
        bv = b.year
        break
      case "added":
        av = time(a.createdAt)
        bv = time(b.createdAt)
        break
      case "publisher":
        av = a.label
        bv = b.label
        break
      case "runtime":
        av = a.runtimeMinutes
        bv = b.runtimeMinutes
        break
    }
    if (av == null && bv == null) continue
    if (av == null) return 1
    if (bv == null) return -1
    const cmp =
      typeof av === "string"
        ? av.localeCompare(bv as string, undefined, { numeric: true })
        : av - (bv as number)
    if (cmp !== 0) return sign * cmp
  }
  return a.sortTitle.localeCompare(b.sortTitle)
}

/** The visual sub-group a film belongs to on a shelf, if grouping is on. */
export function shelfGroupKey(film: Film, shelf: Shelf): string | null {
  switch (shelf.groupBy) {
    case "label":
      return film.label
    case "format":
      return film.format
    case "decade":
      return film.year != null ? `${Math.floor(film.year / 10) * 10}s` : null
    default:
      return null
  }
}

/**
 * Display order for a shelf's films: multi-level sort, then contiguous
 * sub-groups (alphabetical, ungrouped last), then any hand-arranged ids
 * pulled to the front in their saved order.
 */
export function orderShelfFilms(shelf: Shelf, films: Film[]): Film[] {
  const levels = shelf.sort?.length ? shelf.sort : DEFAULT_SORT
  let ordered = [...films].sort((a, b) => compareBySort(a, b, levels))

  if (shelf.groupBy) {
    const groups = new Map<string | null, Film[]>()
    for (const film of ordered) {
      const key = shelfGroupKey(film, shelf)
      const group = groups.get(key) ?? []
      group.push(film)
      groups.set(key, group)
    }
    const keys = [...groups.keys()].sort((a, b) => {
      if (a == null) return 1
      if (b == null) return -1
      return a.localeCompare(b, undefined, { numeric: true })
    })
    ordered = keys.flatMap((key) => groups.get(key)!)
  }

  if (shelf.manualOrder?.length) {
    const rank = new Map(shelf.manualOrder.map((id, i) => [id, i]))
    const placed = ordered
      .filter((f) => rank.has(f.id))
      .sort((a, b) => rank.get(a.id)! - rank.get(b.id)!)
    return [...placed, ...ordered.filter((f) => !rank.has(f.id))]
  }
  return ordered
}

export interface ShelfAssignment {
  /** shelf id → films in display order. */
  byShelf: Map<string, Film[]>
  /** Films no shelf claims — the tray, so nothing silently vanishes. */
  unshelved: Film[]
}

/**
 * Partition the collection across the shelves. Pins win over any rule
 * match (a film pinned to shelf 3 stays there even if shelf 1's rules
 * match it); otherwise the first non-excluding rule match claims the film.
 */
export function assignFilms(films: Film[], shelves: Shelf[]): ShelfAssignment {
  const byShelf = new Map<string, Film[]>(shelves.map((s) => [s.id, []]))
  const unshelved: Film[] = []

  const pinnedTo = new Map<string, string>()
  for (const shelf of shelves) {
    for (const id of shelf.pinned ?? []) {
      if (!pinnedTo.has(id)) pinnedTo.set(id, shelf.id)
    }
  }

  for (const film of films) {
    const pinnedShelf = pinnedTo.get(film.id)
    if (pinnedShelf != null) {
      byShelf.get(pinnedShelf)!.push(film)
      continue
    }
    const home = shelves.find(
      (shelf) =>
        !shelf.excluded?.includes(film.id) && matchesShelfRules(film, shelf)
    )
    if (home) byShelf.get(home.id)!.push(film)
    else unshelved.push(film)
  }

  for (const shelf of shelves) {
    byShelf.set(shelf.id, orderShelfFilms(shelf, byShelf.get(shelf.id)!))
  }
  unshelved.sort((a, b) => a.sortTitle.localeCompare(b.sortTitle))
  return { byShelf, unshelved }
}

/** Films past the shelf's physical capacity — the suggested spill. */
export function shelfOverflow(shelf: Shelf, ordered: Film[]): Film[] {
  if (shelf.capacity == null || shelf.capacity <= 0) return []
  return ordered.slice(shelf.capacity)
}

/** Added since the shelf was last physically arranged. */
export function isNewSinceArranged(shelf: Shelf, film: Film): boolean {
  return (
    shelf.arrangedAt != null && time(film.createdAt) > time(shelf.arrangedAt)
  )
}

// ---------------------------------------------------------------------------
// Edits — every change to a layout lives here.
//
// Each operation takes the current shelves and returns new shelves, and
// changes nothing it is given: the caller keeps the previous layout, so a
// save that fails can put it back. An edit that changes nothing returns the
// shelves it was given, so the caller can skip the save. The rules that
// define a shelf are held here too — above all, a film is pinned to one
// shelf only.
// ---------------------------------------------------------------------------

/** A shelf carries no key for an empty list. */
const listOrNone = (ids: string[]): string[] | undefined =>
  ids.length > 0 ? ids : undefined

const without = (
  ids: string[] | undefined,
  filmId: string
): string[] | undefined => ids && listOrNone(ids.filter((id) => id !== filmId))

/** The list with the item at `index` moved one place by `delta`. */
function swapped<T>(list: T[], index: number, delta: -1 | 1): T[] | null {
  const target = index + delta
  if (index < 0 || index >= list.length) return null
  if (target < 0 || target >= list.length) return null
  const next = [...list]
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

/**
 * Pin a film to a shelf. The pin it held on another shelf goes, and an
 * exclusion of it on this shelf goes: a pin is an instruction to keep the
 * film here, and the other two would send it away.
 */
export function pinFilmToShelf(
  shelves: Shelf[],
  filmId: string,
  shelfId: string
): Shelf[] {
  // A pin to a shelf that is not there would only remove the pin the film
  // has, so do nothing. The other operations change one shelf and thus
  // stop by themselves.
  if (!shelves.some((s) => s.id === shelfId)) return shelves
  return shelves.map((shelf) =>
    shelf.id === shelfId
      ? {
          ...shelf,
          pinned: [
            ...(shelf.pinned ?? []).filter((id) => id !== filmId),
            filmId,
          ],
          excluded: without(shelf.excluded, filmId),
        }
      : { ...shelf, pinned: without(shelf.pinned, filmId) }
  )
}

/** Drop the film's pin — it follows the rules again. */
export function unpinFilm(shelves: Shelf[], filmId: string): Shelf[] {
  if (!shelves.some((s) => s.pinned?.includes(filmId))) return shelves
  return shelves.map((shelf) => ({
    ...shelf,
    pinned: without(shelf.pinned, filmId),
  }))
}

/**
 * Keep a film off a shelf its rules match. It falls through to the next
 * shelf that matches, or to the unshelved tray.
 */
export function excludeFilmFromShelf(
  shelves: Shelf[],
  filmId: string,
  shelfId: string
): Shelf[] {
  const target = shelves.find((s) => s.id === shelfId)
  if (!target) return shelves
  if (target.excluded?.includes(filmId) && !target.pinned?.includes(filmId)) {
    return shelves
  }
  return shelves.map((shelf) =>
    shelf.id === shelfId
      ? {
          ...shelf,
          excluded: [
            ...(shelf.excluded ?? []).filter((id) => id !== filmId),
            filmId,
          ],
          pinned: without(shelf.pinned, filmId),
        }
      : shelf
  )
}

/**
 * Move a film one place along the shelf and save the result as the
 * hand-arranged order. `orderedIds` is the shelf as it reads now.
 */
export function moveFilmOnShelf(
  shelves: Shelf[],
  shelfId: string,
  orderedIds: string[],
  index: number,
  delta: -1 | 1
): Shelf[] {
  const ids = swapped(orderedIds, index, delta)
  if (!ids || !shelves.some((s) => s.id === shelfId)) return shelves
  return shelves.map((shelf) =>
    shelf.id === shelfId ? { ...shelf, manualOrder: ids } : shelf
  )
}

/** Forget the hand-arranged order — the shelf sort takes over again. */
export function clearHandArrangedOrder(
  shelves: Shelf[],
  shelfId: string
): Shelf[] {
  if (!shelves.some((s) => s.id === shelfId && s.manualOrder)) return shelves
  return shelves.map((shelf) =>
    shelf.id === shelfId ? { ...shelf, manualOrder: undefined } : shelf
  )
}

/**
 * Add a shelf, or replace the one with the same id. Pins, exclusions, the
 * hand-arranged order and the arranged date belong to the shelf and not to
 * the form that edits it, so a change to the rules or the sort keeps them
 * whatever the given shelf holds. Only `pinFilmToShelf`, `unpinFilm`,
 * `excludeFilmFromShelf`, `moveFilmOnShelf`, `clearHandArrangedOrder`,
 * `markShelvesArranged` and `forgetFilms` write those four fields.
 */
export function upsertShelf(shelves: Shelf[], shelf: Shelf): Shelf[] {
  const current = shelves.find((s) => s.id === shelf.id)
  if (!current) return [...shelves, shelf]
  const merged: Shelf = {
    ...shelf,
    pinned: current.pinned,
    excluded: current.excluded,
    manualOrder: current.manualOrder,
    arrangedAt: current.arrangedAt,
  }
  return shelves.map((s) => (s.id === shelf.id ? merged : s))
}

export function removeShelf(shelves: Shelf[], shelfId: string): Shelf[] {
  if (!shelves.some((s) => s.id === shelfId)) return shelves
  return shelves.filter((s) => s.id !== shelfId)
}

/** Move a shelf one place up (-1) or down (1). A shelf at an end holds. */
export function moveShelf(
  shelves: Shelf[],
  shelfId: string,
  delta: -1 | 1
): Shelf[] {
  const index = shelves.findIndex((s) => s.id === shelfId)
  if (index === -1) return shelves
  return swapped(shelves, index, delta) ?? shelves
}

/** Put a shelf immediately above another — where a drag is dropped. */
export function moveShelfBefore(
  shelves: Shelf[],
  shelfId: string,
  targetId: string
): Shelf[] {
  const moved = shelves.find((s) => s.id === shelfId)
  if (!moved || shelfId === targetId) return shelves
  const next = shelves.filter((s) => s.id !== shelfId)
  const at = next.findIndex((s) => s.id === targetId)
  if (at === -1) return shelves
  next.splice(at, 0, moved)
  return next
}

/** Record when the physical shelves were arranged — clears the NEW flags. */
export function markShelvesArranged(
  shelves: Shelf[],
  shelfIds: string[],
  arrangedAt: string
): Shelf[] {
  if (!shelves.some((s) => shelfIds.includes(s.id))) return shelves
  return shelves.map((shelf) =>
    shelfIds.includes(shelf.id) ? { ...shelf, arrangedAt } : shelf
  )
}

/**
 * Prune films the collection no longer has: a deleted film leaves no pin,
 * no exclusion and no slot in a hand-arranged order behind it. Returns the
 * same shelves when nothing referenced the films, so a caller can skip the
 * save.
 */
export function forgetFilms(shelves: Shelf[], filmIds: string[]): Shelf[] {
  const gone = new Set(filmIds)
  if (gone.size === 0) return shelves
  /** The same list when it holds none of the films, so a shelf can tell. */
  const keep = (ids: string[] | undefined): string[] | undefined => {
    if (!ids) return ids
    const left = ids.filter((id) => !gone.has(id))
    return left.length === ids.length ? ids : listOrNone(left)
  }
  const next = shelves.map((shelf) => {
    const pinned = keep(shelf.pinned)
    const excluded = keep(shelf.excluded)
    const manualOrder = keep(shelf.manualOrder)
    return pinned === shelf.pinned &&
      excluded === shelf.excluded &&
      manualOrder === shelf.manualOrder
      ? shelf
      : { ...shelf, pinned, excluded, manualOrder }
  })
  return next.some((shelf, i) => shelf !== shelves[i]) ? next : shelves
}

// ---------------------------------------------------------------------------
// Wishlist ghosts — translucent spines showing where a purchase would go.
// Wishlist items only carry title/year/format, so a shelf can host ghosts
// only when every rule tests a field a wishlist item has; richer rules
// (publisher, package…) can't be evaluated and match no ghosts.
// ---------------------------------------------------------------------------

function wishlistFieldValues(
  item: WishlistItem,
  field: ShelfRuleField
): string[] | null {
  switch (field) {
    case "format":
      return item.format ? [item.format] : []
    case "mediaType":
      return ["Movie"]
    case "decade":
      return item.year != null ? [`${Math.floor(item.year / 10) * 10}s`] : []
    default:
      return null
  }
}

function wishlistMatches(item: WishlistItem, shelf: Shelf): boolean {
  return shelf.rules.every((rule) => {
    if (rule.values.length === 0) return true
    const values = wishlistFieldValues(item, rule.field)
    return values != null && values.some((v) => rule.values.includes(v))
  })
}

/** First-match assignment for wishlist items, mirroring the films. */
export function assignWishlist(
  items: WishlistItem[],
  shelves: Shelf[]
): Map<string, WishlistItem[]> {
  const byShelf = new Map<string, WishlistItem[]>()
  for (const item of items) {
    const home = shelves.find((shelf) => wishlistMatches(item, shelf))
    if (!home) continue
    const list = byShelf.get(home.id) ?? []
    list.push(item)
    byShelf.set(home.id, list)
  }
  return byShelf
}

/** Where a ghost would slot into the shelf's current order, by title. */
export function ghostInsertionIndex(
  ordered: Film[],
  item: WishlistItem
): number {
  const ghostTitle = toSortTitle(item.title)
  const index = ordered.findIndex(
    (f) => f.sortTitle.localeCompare(ghostTitle) > 0
  )
  return index === -1 ? ordered.length : index
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

/** Boutique/collector labels — matched loosely against collection labels. */
export const BOUTIQUE_LABELS = [
  "criterion",
  "arrow",
  "mubi",
  "curzon",
  "kino lorber",
  "eureka",
  "masters of cinema",
  "second sight",
  "88 films",
  "bfi",
  "indicator",
  "powerhouse",
  "vinegar syndrome",
  "imprint",
  "shout factory",
  "shout! factory",
  "scream factory",
  "radiance",
  "severin",
  "terracotta",
  "third window",
]

/** Distinct collection labels that look boutique (e.g. "Curzon Film World"). */
export function boutiqueLabelsIn(films: Film[]): string[] {
  const labels = new Set<string>()
  for (const film of films) {
    if (
      film.label &&
      BOUTIQUE_LABELS.some((b) => film.label!.toLowerCase().includes(b))
    ) {
      labels.add(film.label)
    }
  }
  return [...labels].sort((a, b) => a.localeCompare(b))
}

export type ShelfTemplate = "boutique" | "formats" | "everything"

export const SHELF_TEMPLATES: Array<{
  key: ShelfTemplate
  label: string
  description: string
}> = [
  {
    key: "boutique",
    label: "Boutique + formats + TV",
    description:
      "Boutique labels first, then 4K / Blu-ray / DVD movies, TV box sets last",
  },
  {
    key: "formats",
    label: "By format",
    description: "One shelf per disc format",
  },
  {
    key: "everything",
    label: "Single shelf",
    description: "Everything on one alphabetical shelf",
  },
]

const FORMAT_SHELVES: Array<{ name: string; format: string }> = [
  { name: "4K UHD", format: "4K UHD" },
  { name: "Blu-ray", format: "Blu-ray" },
  { name: "DVD", format: "DVD" },
]

/**
 * Starter shelves for a template. The boutique template mirrors the
 * classic collector layout: boutique labels (Criterion sorted by spine via
 * a spine-first sort) claim their titles before the format shelves, and
 * TV box sets sit apart from the movie shelves.
 */
export function buildTemplateShelves(
  template: ShelfTemplate,
  films: Film[],
  newId: () => string = () => crypto.randomUUID()
): Shelf[] {
  switch (template) {
    case "boutique": {
      const boutique = boutiqueLabelsIn(films)
      return [
        ...(boutique.length > 0
          ? [
              {
                id: newId(),
                name: "Boutique editions",
                rules: [{ field: "label" as const, values: boutique }],
                sort: [{ key: "spine" as const }, { key: "title" as const }],
                groupBy: "label" as const,
              },
            ]
          : []),
        ...FORMAT_SHELVES.map(({ name, format }) => ({
          id: newId(),
          name,
          rules: [
            { field: "format" as const, values: [format] },
            { field: "mediaType" as const, values: ["Movie"] },
          ],
        })),
        {
          id: newId(),
          name: "TV box sets",
          rules: [{ field: "mediaType" as const, values: ["TV"] }],
        },
      ]
    }
    case "formats":
      return FORMAT_SHELVES.map(({ name, format }) => ({
        id: newId(),
        name,
        rules: [{ field: "format" as const, values: [format] }],
      }))
    case "everything":
      return [{ id: newId(), name: "Collection", rules: [] }]
  }
}

/** Distinct values (with counts) the collection has for a rule field. */
export function shelfFieldOptions(
  films: Film[],
  field: ShelfRuleField
): Array<[string, number]> {
  const counts = new Map<string, number>()
  for (const film of films) {
    for (const value of shelfFieldValues(film, field)) {
      counts.set(value, (counts.get(value) ?? 0) + 1)
    }
  }
  return [...counts.entries()].sort((a, b) =>
    a[0].localeCompare(b[0], undefined, { numeric: true })
  )
}
