import { describe, expect, it } from "vitest"
import { filmFixture } from "@/test/film-fixture"
import {
  joinShelfPhotos,
  mergeShelfSpines,
  parseShelfCheck,
  serializeShelfCheck,
  shelfCheckSections,
  spineKey,
} from "./shelf-check"
import type { StoredShelfPhoto } from "./shelf-check"
import type { ShelfSpine } from "./shelf-reading"

const spine = (over: Partial<ShelfSpine> & Pick<ShelfSpine, "title">) =>
  ({
    text: over.title.toUpperCase(),
    year: null,
    format: null,
    label: null,
    spineNumber: null,
    legibility: "clear",
    status: "missing",
    film: null,
    ...over,
  }) satisfies ShelfSpine

describe("spineKey", () => {
  it("ignores case, articles, and punctuation but not format or year", () => {
    expect(spineKey(spine({ title: "The Thing", format: "4K UHD" }))).toBe(
      spineKey(spine({ title: "thing", format: "4K UHD" }))
    )
    expect(spineKey(spine({ title: "Thing", format: "DVD" }))).not.toBe(
      spineKey(spine({ title: "Thing", format: "4K UHD" }))
    )
    expect(spineKey(spine({ title: "Thing", year: 1982 }))).not.toBe(
      spineKey(spine({ title: "Thing", year: 2011 }))
    )
  })

  it("gives an unreadable title no key", () => {
    expect(spineKey(spine({ title: "???" }))).toBeNull()
  })
})

describe("mergeShelfSpines", () => {
  it("keeps one copy of a spine seen in overlapping photos, in reading order", () => {
    const merged = mergeShelfSpines([
      [spine({ title: "Alien" }), spine({ title: "Brazil" })],
      [spine({ title: "brazil" }), spine({ title: "Casablanca" })],
    ])
    expect(merged.map((s) => s.title)).toEqual([
      "Alien",
      "Brazil",
      "Casablanca",
    ])
  })

  it("prefers the clearer reading and fills its gaps from the other", () => {
    const merged = mergeShelfSpines([
      [
        spine({
          title: "Dune",
          text: "DU…",
          legibility: "partial",
          label: "Arrow",
        }),
      ],
      [spine({ title: "Dune", text: "DUNE", spineNumber: 12 })],
    ])
    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({
      text: "DUNE",
      legibility: "clear",
      label: "Arrow",
      spineNumber: 12,
    })
  })

  it("keeps the catalogued match when only one reading found it", () => {
    const film = {
      id: "f1",
      title: "Heat",
      year: null,
      format: "Blu-ray",
      coverUrl: null,
    }
    const merged = mergeShelfSpines([
      [spine({ title: "Heat", legibility: "clear" })],
      [spine({ title: "Heat", legibility: "unclear", status: "owned", film })],
    ])
    expect(merged[0]).toMatchObject({
      legibility: "clear",
      status: "owned",
      film,
    })
  })

  it("leaves different formats and years, and unreadable spines, apart", () => {
    const merged = mergeShelfSpines([
      [
        spine({ title: "Dune", format: "4K UHD" }),
        spine({ title: "Dune", format: "DVD" }),
        spine({ title: "?" }),
      ],
      [spine({ title: "Dune", year: 1984 }), spine({ title: "?" })],
    ])
    expect(merged).toHaveLength(5)
  })
})

describe("shelfCheckSections", () => {
  const dune4k = filmFixture({ title: "Dune", year: 2021, format: "4K UHD" })
  const owned = spine({
    title: "Dune",
    year: 2021,
    format: "4K UHD",
    status: "owned",
    film: {
      id: dune4k.id,
      title: "Dune",
      year: 2021,
      format: "4K UHD",
      coverUrl: null,
    },
  })
  const otherFormat = spine({
    title: "Dune",
    year: 2021,
    format: "Blu-ray",
    status: "other-format",
    film: owned.film,
  })
  const missing = spine({ title: "Paris, Texas", format: "Blu-ray" })

  it("sorts spines by what the server judged", () => {
    const sections = shelfCheckSections([owned, otherFormat, missing], [dune4k])
    expect(sections.owned.map((e) => e.spine)).toEqual([owned])
    expect(sections.otherFormat.map((e) => e.spine)).toEqual([otherFormat])
    expect(sections.missing.map((e) => e.spine)).toEqual([missing])
    expect(
      [...sections.missing, ...sections.otherFormat].map((e) => e.added)
    ).toEqual([null, null])
  })

  it("marks a missing title added once the collection has it", () => {
    const added = filmFixture({ title: "Paris Texas", format: "DVD" })
    const sections = shelfCheckSections([missing], [dune4k, added])
    expect(sections.missing[0].added).toBe(added)
  })

  it("marks another-format spines added only for a copy in that format", () => {
    const sections = shelfCheckSections([otherFormat], [dune4k])
    expect(sections.otherFormat[0].added).toBeNull()

    const bluray = filmFixture({ title: "Dune", year: 2021, format: "Blu-ray" })
    expect(
      shelfCheckSections([otherFormat], [dune4k, bluray]).otherFormat[0].added
    ).toBe(bluray)
  })

  it("gives every entry a distinct key", () => {
    const sections = shelfCheckSections([missing, missing], [])
    expect(new Set(sections.missing.map((e) => e.key)).size).toBe(2)
  })
})

describe("stored shelf checks", () => {
  const photos: Array<StoredShelfPhoto> = [
    {
      id: "p1",
      name: "shelf.jpg",
      thumbnail: "data:image/jpeg;base64,AAAA",
      result: { ok: true, spines: [spine({ title: "Alien", year: 1979 })] },
    },
    {
      id: "p2",
      name: "blurry.jpg",
      thumbnail: null,
      result: { ok: false, error: "Reading the shelf photo failed." },
    },
  ]

  it("round-trips through a string", () => {
    expect(parseShelfCheck(serializeShelfCheck(photos))).toEqual(photos)
  })

  it("starts empty from nothing, junk, or an older shape", () => {
    expect(parseShelfCheck(null)).toEqual([])
    expect(parseShelfCheck("{not json")).toEqual([])
    expect(parseShelfCheck(JSON.stringify({ photos: [{ id: 1 }] }))).toEqual([])
  })
})

describe("joinShelfPhotos", () => {
  const film = (title: string) => ({
    id: title,
    title,
    year: null,
    format: "DVD",
    coverUrl: null,
  })
  const catalogued = (title: string) =>
    spine({ title, status: "owned", film: film(title) })

  it("keeps every photo's spines in order, catalogued ones untouched", () => {
    const joined = joinShelfPhotos([
      [catalogued("Alien"), catalogued("Brazil")],
      [catalogued("Brazil"), catalogued("Cure")],
    ])
    // The order check drops the second Brazil by its id.
    expect(joined.map((s) => s.title)).toEqual([
      "Alien",
      "Brazil",
      "Brazil",
      "Cure",
    ])
  })

  it("drops an uncatalogued spine the previous photo already showed", () => {
    const joined = joinShelfPhotos([
      [catalogued("Alien"), spine({ title: "Stalker" })],
      [spine({ title: "stalker" }), catalogued("Cure")],
      [catalogued("Dune"), spine({ title: "Solaris" })],
    ])
    expect(joined.map((s) => s.title)).toEqual([
      "Alien",
      "Stalker",
      "Cure",
      "Dune",
      "Solaris",
    ])
  })

  it("keeps two copies in one photo, and unreadable spines", () => {
    const joined = joinShelfPhotos([
      [spine({ title: "Solaris" }), spine({ title: "Solaris" })],
      [spine({ title: "?" }), spine({ title: "?" })],
    ])
    expect(joined).toHaveLength(4)
  })
})
