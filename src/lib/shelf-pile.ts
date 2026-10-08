import type { Film, Shelf, ShelfOrientation } from "@/db/schema"

/**
 * Drawing a stacked shelf as a pile of cases lying flat. Each case is a bar
 * as long as the case is tall and as thick as its spine, so a pile of mixed
 * formats looks like the real one: DVD cases are the longest and thickest,
 * steelbooks thin, box sets thick. Pure, so the sizing is tested.
 */

/** A shelf's orientation; unset means discs standing upright. */
export function shelfOrientation(
  shelf: Pick<Shelf, "orientation">
): ShelfOrientation {
  return shelf.orientation ?? "upright"
}

/** Case height (its length lying flat) and spine thickness, in mm. */
const CASES: Record<string, { length: number; thickness: number }> = {
  DVD: { length: 190, thickness: 14 },
  "Blu-ray": { length: 170, thickness: 11 },
  "4K UHD": { length: 170, thickness: 12 },
}
const LONGEST_CASE_MM = 190

/** Spine millimetres to pixels: a Blu-ray case comes out 26 px thick. */
const PX_PER_MM = 2.4
/** No thinner than a comfortable tap target, no thicker than a box set needs. */
const MIN_THICKNESS_PX = 24
const MAX_THICKNESS_PX = 64

export interface PileCase {
  /** Length as a fraction of the longest case (a DVD's). */
  length: number
  /** Spine thickness in pixels. */
  thickness: number
}

/** How big a disc's case draws in a pile. */
export function pileCase(
  disc: Partial<Pick<Film, "packageType" | "discCount">> & Pick<Film, "format">
): PileCase {
  const size = CASES[disc.format] ?? CASES["Blu-ray"]
  let mm = size.thickness
  if (disc.packageType === "Steelbook") mm = Math.min(mm, 10)
  if (disc.packageType === "Boxset" || disc.packageType === "Mediabook") {
    mm += 8
  }
  // A standard case holds two discs; more need a fatter one.
  const extraDiscs = Math.max(0, (disc.discCount ?? 1) - 2)
  mm += Math.min(12, extraDiscs * 3)
  return {
    length: size.length / LONGEST_CASE_MM,
    thickness: Math.min(
      MAX_THICKNESS_PX,
      Math.max(MIN_THICKNESS_PX, Math.round(mm * PX_PER_MM))
    ),
  }
}

/**
 * A small, steady sideways nudge for a case, so a pile looks hand-stacked
 * rather than ruled. The same id always gets the same nudge, within ±max.
 */
export function pileOffset(id: string, max = 6): number {
  // FNV-1a: cheap, and spreads similar ids apart.
  let hash = 0x811c9dc5
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return ((hash >>> 0) % (2 * max + 1)) - max
}
