import { describe, expect, it } from "vitest"
import { filmFixture } from "@/test/film-fixture"
import {
  SHELF_READING_JSON_SCHEMA,
  collectionListText,
  resolveShelfSpines,
  shelfReadingSchema,
} from "./shelf-reading"
import type { ShelfReading } from "./shelf-reading"

type Spine = ShelfReading["spines"][number]

const spine = (overrides: Partial<Spine>): Spine => ({
  text: overrides.title ?? "",
  title: "",
  year: null,
  format: null,
  label: null,
  spineNumber: null,
  legibility: "clear",
  match: null,
  ...overrides,
})

describe("resolveShelfSpines", () => {
  const dune4k = filmFixture({ title: "Dune", year: 2021, format: "4K UHD" })
  const duneDvd = filmFixture({ title: "Dune", year: 2021, format: "DVD" })
  const alien = filmFixture({ title: "Alien", year: 1979, format: "Blu-ray" })
  const films = [alien, dune4k, duneDvd]

  it("takes the model's match by list number", () => {
    const [result] = resolveShelfSpines(
      { spines: [spine({ title: "Alien", match: 1 })] },
      films
    )
    expect(result.status).toBe("owned")
    expect(result.film?.id).toBe(alien.id)
  })

  it("moves the match to the copy in the spine's format", () => {
    const [result] = resolveShelfSpines(
      { spines: [spine({ title: "Dune", format: "DVD", match: 2 })] },
      films
    )
    expect(result.status).toBe("owned")
    expect(result.film?.id).toBe(duneDvd.id)
  })

  it("flags a title catalogued only in another format", () => {
    const [result] = resolveShelfSpines(
      { spines: [spine({ title: "Alien", format: "4K UHD", match: 1 })] },
      films
    )
    expect(result.status).toBe("other-format")
    expect(result.film?.id).toBe(alien.id)
  })

  it("reports an unmatched spine as missing", () => {
    const [result] = resolveShelfSpines(
      { spines: [spine({ title: "Stalker" })] },
      films
    )
    expect(result).toMatchObject({ status: "missing", film: null })
  })

  it("ignores a match number outside the list", () => {
    const [result] = resolveShelfSpines(
      { spines: [spine({ title: "Stalker", match: 99 })] },
      films
    )
    expect(result.status).toBe("missing")
  })

  it("backs up an unmatched spine with an exact title match", () => {
    const [result] = resolveShelfSpines(
      { spines: [spine({ title: "ALIEN", year: 1979 })] },
      films
    )
    expect(result.film?.id).toBe(alien.id)
  })
})

describe("the shelf reading contract", () => {
  it("numbers the collection from 1", () => {
    const text = collectionListText([
      filmFixture({ title: "Alien", year: 1979, format: "DVD", label: "Fox" }),
      filmFixture({
        title: "Seven Samurai",
        year: 1954,
        label: "Criterion",
        spineNumber: 2,
      }),
    ])
    expect(text).toContain("1. Alien (1979) · DVD · Fox")
    expect(text).toContain(
      "2. Seven Samurai (1954) · Blu-ray · Criterion · spine #2"
    )
  })

  it("requires every field the validator reads", () => {
    const item = SHELF_READING_JSON_SCHEMA.properties.spines.items
    expect([...item.required].sort()).toEqual(
      Object.keys(shelfReadingSchema.shape.spines.element.shape).sort()
    )
  })
})
