import { describe, expect, it } from "vitest"
import { filmFixture } from "@/test/film-fixture"
import {
  checkShelfOrder,
  guessPhotographedShelf,
  longestIncreasingRun,
} from "./shelf-order"
import type { ShelfSpine } from "./shelf-reading"
import type { Film, Shelf } from "@/db/schema"

const dvdShelf: Shelf = {
  id: "dvd",
  name: "DVD",
  rules: [{ field: "format", values: ["DVD"] }],
}
const blurayShelf: Shelf = {
  id: "bluray",
  name: "Blu-ray",
  rules: [{ field: "format", values: ["Blu-ray"] }],
}
const shelves = [dvdShelf, blurayShelf]

const dvd = (title: string) => filmFixture({ title, format: "DVD" })
const alien = dvd("Alien")
const brazil = dvd("Brazil")
const cure = dvd("Cure")
const dune = dvd("Dune")
const eraserhead = dvd("Eraserhead")
const heat = filmFixture({ title: "Heat", format: "Blu-ray" })
const loose = filmFixture({ title: "Loose", format: "4K UHD" })
const films = [alien, brazil, cure, dune, eraserhead, heat, loose]

/** A spine the model read and matched to `film` (or nothing). */
const spineOf = (film: Film | string): ShelfSpine =>
  typeof film === "string"
    ? {
        text: film,
        title: film,
        year: null,
        format: null,
        label: null,
        spineNumber: null,
        legibility: "clear",
        status: "missing",
        film: null,
      }
    : {
        text: film.title,
        title: film.title,
        year: film.year,
        format: null,
        label: null,
        spineNumber: null,
        legibility: "clear",
        status: "owned",
        film: {
          id: film.id,
          title: film.title,
          year: film.year,
          format: film.format,
          coverUrl: null,
        },
      }

const placements = (photo: ShelfSpine[]) =>
  checkShelfOrder(photo, dvdShelf, films, shelves).spines.map(
    (s) => `${s.spine.title}:${s.placement}`
  )

describe("checkShelfOrder", () => {
  it("passes a shelf in its expected order", () => {
    expect(placements([alien, brazil, cure, dune].map(spineOf))).toEqual([
      "Alien:in-order",
      "Brazil:in-order",
      "Cure:in-order",
      "Dune:in-order",
    ])
  })

  it("flags the fewest discs that need moving, and says where each goes", () => {
    const check = checkShelfOrder(
      [alien, dune, brazil, cure, eraserhead].map(spineOf),
      dvdShelf,
      films,
      shelves
    )
    const moved = check.spines.filter((s) => s.placement === "out-of-order")
    expect(moved.map((s) => s.film?.title)).toEqual(["Dune"])
    expect(moved[0].moveAfter?.title).toBe("Cure")
    expect(moved[0].moveBefore?.title).toBe("Eraserhead")
  })

  it("points a disc at the start or end when nothing in place precedes or follows it", () => {
    const check = checkShelfOrder(
      [brazil, cure, alien].map(spineOf),
      dvdShelf,
      films,
      shelves
    )
    const alienSpine = check.spines.find((s) => s.film?.id === alien.id)!
    expect(alienSpine.placement).toBe("out-of-order")
    expect(alienSpine.moveAfter).toBeNull()
    expect(alienSpine.moveBefore?.title).toBe("Brazil")
  })

  it("separates discs from other shelves, unshelved, and uncatalogued", () => {
    expect(
      placements([
        spineOf(alien),
        spineOf(heat),
        spineOf(loose),
        spineOf("Stalker"),
      ])
    ).toEqual([
      "Alien:in-order",
      "Heat:other-shelf",
      "Loose:unshelved",
      "Stalker:not-catalogued",
    ])
    const check = checkShelfOrder([spineOf(heat)], dvdShelf, films, shelves)
    expect(check.spines[0].belongsOn?.id).toBe("bluray")
  })

  it("lists discs missing from the photographed stretch, not beyond it", () => {
    const check = checkShelfOrder(
      [brazil, dune].map(spineOf),
      dvdShelf,
      films,
      shelves
    )
    expect(check.absent.map((f) => f.title)).toEqual(["Cure"])
  })

  it("counts a disc seen twice in overlapping photos once", () => {
    expect(placements([alien, brazil, brazil, cure].map(spineOf))).toEqual([
      "Alien:in-order",
      "Brazil:in-order",
      "Cure:in-order",
    ])
  })

  it("follows a hand-arranged order", () => {
    const arranged: Shelf = {
      ...dvdShelf,
      manualOrder: [dune.id, alien.id],
    }
    const check = checkShelfOrder(
      [dune, alien, brazil].map(spineOf),
      arranged,
      films,
      [arranged, blurayShelf]
    )
    expect(check.spines.every((s) => s.placement === "in-order")).toBe(true)
  })
})

describe("guessPhotographedShelf", () => {
  it("picks the shelf that's home to most of the photographed discs", () => {
    expect(
      guessPhotographedShelf([alien, brazil, heat].map(spineOf), films, shelves)
        ?.id
    ).toBe("dvd")
  })

  it("has no guess when nothing photographed is shelved", () => {
    expect(
      guessPhotographedShelf([spineOf("Stalker")], films, shelves)
    ).toBeNull()
  })
})

describe("longestIncreasingRun", () => {
  it("finds one longest strictly increasing subsequence", () => {
    const values = [0, 3, 1, 2, 4]
    expect(longestIncreasingRun(values).map((i) => values[i])).toEqual([
      0, 1, 2, 4,
    ])
    expect(longestIncreasingRun([])).toEqual([])
  })
})
