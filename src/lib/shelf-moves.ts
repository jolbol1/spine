import type { PlacedSpine, ShelfOrderCheck } from "@/lib/shelf-order"
import type { Film, ShelfOrientation } from "@/db/schema"

/**
 * Putting a shelf order check into words. An upright shelf runs left to
 * right, from its start to its end; a stack runs top to bottom, so a disc
 * goes "to the top, above" rather than "to the start, before". Pure, so the
 * wording is tested.
 */

export const READING_WORDS = {
  upright: {
    direction: "left to right",
    start: "start",
    end: "end",
    before: "before",
    after: "after",
  },
  stacked: {
    direction: "top to bottom",
    start: "top",
    end: "bottom",
    before: "above",
    after: "below",
  },
} as const satisfies Record<ShelfOrientation, Record<string, string>>

/** A piece of a sentence: plain words, or a disc whose title is emphasised. */
export type Phrase = { text: string } | { film: Film }

export const phraseText = (phrases: ReadonlyArray<Phrase>) =>
  phrases.map((p) => ("text" in p ? p.text : p.film.title)).join("")

/** Where an out-of-place disc goes: "Move Dune between Cure and Eraserhead". */
export function moveSentence(
  spine: PlacedSpine,
  orientation: ShelfOrientation
): Array<Phrase> | null {
  if (spine.placement !== "out-of-order" || !spine.film) return null
  const words = READING_WORDS[orientation]
  const { moveAfter: after, moveBefore: before } = spine
  const phrases: Array<Phrase> = [{ text: "Move " }, { film: spine.film }]
  if (after && before) {
    phrases.push(
      { text: " between " },
      { film: after },
      { text: " and " },
      { film: before }
    )
  } else if (before) {
    phrases.push(
      { text: ` to the ${words.start}, ${words.before} ` },
      { film: before }
    )
  } else if (after) {
    phrases.push(
      { text: ` to the ${words.end}, ${words.after} ` },
      { film: after }
    )
  } else {
    phrases.push({ text: " back into the shelf's order" })
  }
  return phrases
}

export interface OrderCounts {
  inOrder: number
  moves: number
  otherShelf: number
  unshelved: number
  notCatalogued: number
}

export function orderCounts(check: ShelfOrderCheck): OrderCounts {
  const count = (placement: PlacedSpine["placement"]) =>
    check.spines.filter((s) => s.placement === placement).length
  return {
    inOrder: count("in-order"),
    moves: count("out-of-order"),
    otherShelf: count("other-shelf"),
    unshelved: count("unshelved"),
    notCatalogued: count("not-catalogued"),
  }
}

/** "All 24 in order", or "3 to move". */
export function orderSummary(counts: OrderCounts): string {
  if (counts.moves > 0) return `${counts.moves} to move`
  if (counts.inOrder === 0) return "Nothing photographed belongs on this shelf"
  return counts.inOrder === 1 ? "In order" : `All ${counts.inOrder} in order`
}

/**
 * True when the photographed stretch can be marked arranged: something of
 * this shelf's is there, nothing needs moving, and nothing from another
 * shelf is in the way.
 */
export function isInOrder(counts: OrderCounts): boolean {
  return counts.inOrder > 0 && counts.moves === 0 && counts.otherShelf === 0
}

/** "your DVD shelf" — without doubling a name that already says shelf. */
export function shelfPhrase(name: string): string {
  return /shelf$/i.test(name.trim()) ? `your ${name}` : `your ${name} shelf`
}
