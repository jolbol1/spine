import { describe, expect, it } from "vitest"
import { filmFixture } from "@/test/film-fixture"
import {
  isInOrder,
  moveSentence,
  orderCounts,
  orderSummary,
  phraseText,
  shelfPhrase,
} from "./shelf-moves"
import type { PlacedSpine, ShelfOrderCheck } from "./shelf-order"
import type { Film } from "@/db/schema"

const alien = filmFixture({ title: "Alien" })
const brazil = filmFixture({ title: "Brazil" })
const cure = filmFixture({ title: "Cure" })
const dune = filmFixture({ title: "Dune" })
const eraserhead = filmFixture({ title: "Eraserhead" })

const placed = (
  film: Film | null,
  placement: PlacedSpine["placement"],
  moveAfter: Film | null = null,
  moveBefore: Film | null = null
): PlacedSpine => ({
  spine: {
    text: film?.title ?? "Stalker",
    title: film?.title ?? "Stalker",
    year: null,
    format: null,
    label: null,
    spineNumber: null,
    legibility: "clear",
    status: film ? "owned" : "missing",
    film: null,
  },
  placement,
  film,
  moveAfter,
  moveBefore,
  belongsOn: null,
})

const sentence = (spine: PlacedSpine, orientation: "upright" | "stacked") =>
  phraseText(moveSentence(spine, orientation) ?? [])

describe("moveSentence", () => {
  const between = placed(dune, "out-of-order", cure, eraserhead)
  const toStart = placed(alien, "out-of-order", null, brazil)
  const toEnd = placed(eraserhead, "out-of-order", dune, null)

  it("says where a disc goes on an upright shelf", () => {
    expect(sentence(between, "upright")).toBe(
      "Move Dune between Cure and Eraserhead"
    )
    expect(sentence(toStart, "upright")).toBe(
      "Move Alien to the start, before Brazil"
    )
    expect(sentence(toEnd, "upright")).toBe(
      "Move Eraserhead to the end, after Dune"
    )
  })

  it("talks top and bottom for a stack", () => {
    expect(sentence(between, "stacked")).toBe(
      "Move Dune between Cure and Eraserhead"
    )
    expect(sentence(toStart, "stacked")).toBe(
      "Move Alien to the top, above Brazil"
    )
    expect(sentence(toEnd, "stacked")).toBe(
      "Move Eraserhead to the bottom, below Dune"
    )
  })

  it("keeps the titles apart from the words so they can be emphasised", () => {
    expect(moveSentence(between, "upright")).toEqual([
      { text: "Move " },
      { film: dune },
      { text: " between " },
      { film: cure },
      { text: " and " },
      { film: eraserhead },
    ])
  })

  it("has nothing to say about a disc that stays put", () => {
    expect(moveSentence(placed(brazil, "in-order"), "upright")).toBeNull()
    expect(moveSentence(placed(null, "not-catalogued"), "upright")).toBeNull()
  })
})

describe("order summary", () => {
  const check = (spines: Array<PlacedSpine>): ShelfOrderCheck => ({
    shelf: { id: "s", name: "DVD", rules: [] },
    spines,
    absent: [],
  })

  it("counts all in order, or the moves to make", () => {
    const inOrder = orderCounts(
      check([placed(alien, "in-order"), placed(brazil, "in-order")])
    )
    expect(orderSummary(inOrder)).toBe("All 2 in order")
    expect(isInOrder(inOrder)).toBe(true)

    const moves = orderCounts(
      check([
        placed(alien, "in-order"),
        placed(dune, "out-of-order", alien, null),
        placed(cure, "out-of-order", alien, null),
        placed(null, "not-catalogued"),
      ])
    )
    expect(moves).toMatchObject({ inOrder: 1, moves: 2, notCatalogued: 1 })
    expect(orderSummary(moves)).toBe("2 to move")
    expect(isInOrder(moves)).toBe(false)
  })

  it("won't call a shelf arranged with another shelf's disc on it", () => {
    const counts = orderCounts(
      check([placed(alien, "in-order"), placed(brazil, "other-shelf")])
    )
    expect(orderSummary(counts)).toBe("In order")
    expect(isInOrder(counts)).toBe(false)
  })

  it("says so when nothing photographed belongs here", () => {
    const counts = orderCounts(check([placed(null, "not-catalogued")]))
    expect(orderSummary(counts)).toBe(
      "Nothing photographed belongs on this shelf"
    )
    expect(isInOrder(counts)).toBe(false)
  })
})

describe("shelfPhrase", () => {
  it("names a shelf without saying shelf twice", () => {
    expect(shelfPhrase("DVD")).toBe("your DVD shelf")
    expect(shelfPhrase("Top shelf")).toBe("your Top shelf")
    expect(shelfPhrase("Bookshelf")).toBe("your Bookshelf")
  })
})
