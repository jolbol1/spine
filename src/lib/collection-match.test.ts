import { describe, expect, it } from "vitest"
import { filmFixture } from "@/test/film-fixture"
import {
  barcodeKey,
  findDuplicates,
  isSameDisc,
  titleKey,
} from "./collection-match"

describe("titleKey", () => {
  it.each([
    ["The Godfather: Part II", "godfather part ii"],
    ["Amélie", "amelie"],
    ["Crouching Tiger & Hidden Dragon", "crouching tiger and hidden dragon"],
    ["  A Ghost Story ", "ghost story"],
    ["Se7en", "SE7EN"],
  ])("treats %s and %s as the same title", (a, b) => {
    expect(titleKey(a)).toBe(titleKey(b))
  })

  it("keeps different titles apart", () => {
    expect(titleKey("Alien")).not.toBe(titleKey("Aliens"))
  })
})

describe("barcodeKey", () => {
  it("matches a UPC-A to its EAN-13 form", () => {
    expect(barcodeKey("0 123456 789012")).toBe(barcodeKey("123456789012"))
  })

  it("ignores values too short to be a barcode", () => {
    expect(barcodeKey("12-34")).toBeNull()
    expect(barcodeKey(null)).toBeNull()
  })
})

describe("findDuplicates", () => {
  const dune4k = filmFixture({
    title: "Dune",
    year: 2021,
    format: "4K UHD",
    barcode: "5051892234953",
  })
  const duneLynch = filmFixture({
    title: "Dune",
    year: 1984,
    format: "Blu-ray",
  })
  const alien = filmFixture({ title: "Alien", year: 1979, format: "DVD" })
  const films = [dune4k, duneLynch, alien]

  it("finds the same disc by barcode, whatever the title says", () => {
    const matches = findDuplicates(films, {
      title: "Something else",
      barcode: "5051892234953",
    })
    expect(matches).toEqual([{ film: dune4k, reason: "barcode" }])
    expect(isSameDisc(matches)).toBe(true)
  })

  it("matches title and year, telling formats apart", () => {
    expect(
      findDuplicates(films, { title: "dune", year: 2021, format: "4K UHD" })
    ).toEqual([{ film: dune4k, reason: "same-format" }])

    const other = findDuplicates(films, {
      title: "Dune",
      year: 2021,
      format: "DVD",
    })
    expect(other).toEqual([{ film: dune4k, reason: "other-format" }])
    expect(isSameDisc(other)).toBe(false)
  })

  it("separates remakes by year, but matches every year when none is given", () => {
    expect(
      findDuplicates(films, { title: "Dune", year: 1984 }).map((m) => m.film)
    ).toEqual([duneLynch])
    expect(
      findDuplicates(films, { title: "The Dune" }).map((m) => m.film)
    ).toEqual([dune4k, duneLynch])
  })

  it("leaves out the film being edited", () => {
    expect(
      findDuplicates(films, { title: "Alien", year: 1979 }, alien.id)
    ).toEqual([])
  })

  it("puts a barcode match ahead of title matches", () => {
    const matches = findDuplicates(films, {
      title: "Dune",
      barcode: "5051892234953",
    })
    expect(matches.map((m) => m.reason)).toEqual(["barcode", "same-format"])
  })

  it("finds nothing for an empty title and no barcode", () => {
    expect(findDuplicates(films, { title: "  " })).toEqual([])
  })
})
