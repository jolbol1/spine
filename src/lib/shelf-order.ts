import { assignFilms } from "@/lib/shelves"
import type { ShelfSpine } from "@/lib/shelf-reading"
import type { Film, Shelf } from "@/db/schema"

/**
 * Checking a photographed shelf against its digital twin: which discs stand
 * where the shelf's order puts them, which are out of place (and where each
 * goes), and which belong on another shelf. Spines arrive in reading order —
 * left to right for an upright shelf, top to bottom for a stack — which is
 * the shelf's order from first to last. The iOS app ports this file
 * (ios/Spine/Features/Shelves/ShelfOrder.swift); keep the two in step.
 */

export type SpinePlacement =
  /** Where the shelf's order expects it. */
  | "in-order"
  /** Belongs on this shelf, but somewhere else along it. */
  | "out-of-order"
  /** Belongs on a different shelf. */
  | "other-shelf"
  /** Catalogued, but no shelf claims it. */
  | "unshelved"
  /** Not in the collection (in this format). */
  | "not-catalogued"

export interface PlacedSpine {
  spine: ShelfSpine
  placement: SpinePlacement
  /** The catalogued film this spine is, when it is one. */
  film: Film | null
  /** Out of order: the in-place disc it goes after (null = the start). */
  moveAfter: Film | null
  /** Out of order: the in-place disc it goes before (null = the end). */
  moveBefore: Film | null
  /** Other shelf: the shelf it belongs on. */
  belongsOn: Shelf | null
}

export interface ShelfOrderCheck {
  shelf: Shelf
  /** Every spine, in reading order, with repeats from overlapping photos removed. */
  spines: PlacedSpine[]
  /**
   * Discs the shelf should hold between the first and last in-place discs
   * photographed that the photos don't show — moved, lent, or misfiled.
   */
  absent: Film[]
}

/** The catalogued film a spine is, when the photo shows that exact edition. */
function spineFilm(spine: ShelfSpine, byId: Map<string, Film>): Film | null {
  return spine.status === "owned" && spine.film
    ? (byId.get(spine.film.id) ?? null)
    : null
}

/**
 * The shelf a photo most likely shows: the one that's home to the most of
 * its catalogued spines. Null when none of them is shelved.
 */
export function guessPhotographedShelf(
  spines: readonly ShelfSpine[],
  films: Film[],
  shelves: Shelf[]
): Shelf | null {
  const { byShelf } = assignFilms(films, shelves)
  const homeOf = new Map<string, string>()
  for (const [shelfId, shelfFilms] of byShelf) {
    for (const film of shelfFilms) homeOf.set(film.id, shelfId)
  }
  const votes = new Map<string, number>()
  for (const spine of spines) {
    const home =
      spine.status === "owned" && spine.film
        ? homeOf.get(spine.film.id)
        : undefined
    if (home) votes.set(home, (votes.get(home) ?? 0) + 1)
  }
  let best: Shelf | null = null
  for (const shelf of shelves) {
    const count = votes.get(shelf.id) ?? 0
    if (count > 0 && (best == null || count > (votes.get(best.id) ?? 0))) {
      best = shelf
    }
  }
  return best
}

export function checkShelfOrder(
  spines: readonly ShelfSpine[],
  shelf: Shelf,
  films: Film[],
  shelves: Shelf[]
): ShelfOrderCheck {
  const byId = new Map(films.map((film) => [film.id, film]))
  const { byShelf } = assignFilms(films, shelves)
  const expected = byShelf.get(shelf.id) ?? []
  const position = new Map(expected.map((film, index) => [film.id, index]))
  const rank = (film: Film) => position.get(film.id) ?? -1
  const homeOf = new Map<string, Shelf>()
  for (const other of shelves) {
    for (const film of byShelf.get(other.id) ?? []) homeOf.set(film.id, other)
  }

  // Overlapping photos show the same disc twice; keep its first sighting.
  const seen = new Set<string>()
  const unique = spines.filter((spine) => {
    const film = spineFilm(spine, byId)
    if (!film) return true
    if (seen.has(film.id)) return false
    seen.add(film.id)
    return true
  })

  // The longest run already in shelf order stays put; everything else on
  // this shelf moves. That's the fewest moves that put the shelf right.
  const onShelf = unique
    .map((spine, index) => ({ index, film: spineFilm(spine, byId) }))
    .filter(
      (entry): entry is { index: number; film: Film } =>
        entry.film != null && position.has(entry.film.id)
    )
  const keep = longestIncreasingRun(onShelf.map((entry) => rank(entry.film)))
  const inPlace = new Set(keep.map((i) => onShelf[i].index))
  const anchors = keep
    .map((i) => onShelf[i].film)
    .sort((a, b) => rank(a) - rank(b))

  const placed = unique.map((spine, index): PlacedSpine => {
    const film = spineFilm(spine, byId)
    const base = {
      spine,
      film,
      moveAfter: null,
      moveBefore: null,
      belongsOn: null,
    }
    if (!film) return { ...base, placement: "not-catalogued" }
    if (position.has(film.id)) {
      if (inPlace.has(index)) return { ...base, placement: "in-order" }
      const target = rank(film)
      return {
        ...base,
        placement: "out-of-order",
        moveAfter: [...anchors].reverse().find((a) => rank(a) < target) ?? null,
        moveBefore: anchors.find((a) => rank(a) > target) ?? null,
      }
    }
    const home = homeOf.get(film.id)
    return home
      ? { ...base, placement: "other-shelf", belongsOn: home }
      : { ...base, placement: "unshelved" }
  })

  const first = anchors.at(0)
  const last = anchors.at(-1)
  const absent =
    first && last
      ? expected
          .slice(rank(first), rank(last) + 1)
          .filter((film) => !seen.has(film.id))
      : []

  return { shelf, spines: placed, absent }
}

/**
 * Indexes into `values` of one longest strictly increasing subsequence
 * (patience sorting, O(n log n)).
 */
export function longestIncreasingRun(values: readonly number[]): number[] {
  const tails: number[] = []
  const previous: number[] = new Array<number>(values.length).fill(-1)
  for (let i = 0; i < values.length; i++) {
    let lo = 0
    let hi = tails.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (values[tails[mid]] < values[i]) lo = mid + 1
      else hi = mid
    }
    if (lo > 0) previous[i] = tails[lo - 1]
    tails[lo] = i
  }
  const run: number[] = []
  for (let i = tails.at(-1) ?? -1; i !== -1; i = previous[i]) run.push(i)
  return run.reverse()
}
