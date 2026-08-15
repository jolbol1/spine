import { describe, expect, it } from "vitest"
import { filmFixture, tmdbDetailsFixture } from "@/test/film-fixture"
import type { Shelf, WishlistItem } from "@/db/schema"
import {
  assignFilms,
  assignWishlist,
  boutiqueLabelsIn,
  buildTemplateShelves,
  ghostInsertionIndex,
  isNewSinceArranged,
  matchesShelfRules,
  orderShelfFilms,
  shelfOverflow,
} from "./shelves"

const shelf = (overrides: Partial<Shelf> & { name: string }): Shelf => ({
  id: `shelf-${overrides.name}`,
  rules: [],
  ...overrides,
})

describe("rule matching", () => {
  it("ANDs rules and ORs values within a rule", () => {
    const s = shelf({
      name: "Boutique 4K",
      rules: [
        { field: "label", values: ["Criterion", "Arrow"] },
        { field: "format", values: ["4K UHD"] },
      ],
    })
    expect(
      matchesShelfRules(
        filmFixture({ title: "A", label: "Arrow", format: "4K UHD" }),
        s
      )
    ).toBe(true)
    expect(
      matchesShelfRules(filmFixture({ title: "B", label: "Arrow" }), s)
    ).toBe(false)
    expect(
      matchesShelfRules(
        filmFixture({ title: "C", label: "MUBI", format: "4K UHD" }),
        s
      )
    ).toBe(false)
  })

  it("treats unmatched titles as movies and missing HDR as SDR", () => {
    const movie = filmFixture({ title: "Mystery", tmdbMediaType: null })
    expect(
      matchesShelfRules(
        movie,
        shelf({ name: "M", rules: [{ field: "mediaType", values: ["Movie"] }] })
      )
    ).toBe(true)
    expect(
      matchesShelfRules(
        movie,
        shelf({ name: "S", rules: [{ field: "hdr", values: ["SDR"] }] })
      )
    ).toBe(true)
  })

  it("matches genre when any film genre is wanted", () => {
    const horror = filmFixture({
      title: "It",
      tmdbDetails: tmdbDetailsFixture({ genres: ["Horror", "Thriller"] }),
    })
    const s = shelf({
      name: "Spooky",
      rules: [{ field: "genre", values: ["Horror"] }],
    })
    expect(matchesShelfRules(horror, s)).toBe(true)
    expect(matchesShelfRules(filmFixture({ title: "Up" }), s)).toBe(false)
  })

  it("empty rule lists and empty value lists match everything", () => {
    const f = filmFixture({ title: "Anything" })
    expect(matchesShelfRules(f, shelf({ name: "All" }))).toBe(true)
    expect(
      matchesShelfRules(
        f,
        shelf({ name: "Draft", rules: [{ field: "label", values: [] }] })
      )
    ).toBe(true)
  })
})

describe("assignment", () => {
  const criterion4k = filmFixture({
    title: "Risky Business",
    label: "Criterion",
    format: "4K UHD",
    spineNumber: 1227,
  })
  const criterionBd = filmFixture({
    title: "Anora",
    label: "Criterion",
    spineNumber: 1259,
  })
  const plain4k = filmFixture({ title: "Dune", format: "4K UHD" })
  const plainBd = filmFixture({ title: "Rush" })
  const plainDvd = filmFixture({ title: "Big Fish", format: "DVD" })
  const tvDvd = filmFixture({
    title: "Succession",
    format: "DVD",
    tmdbMediaType: "tv",
  })

  const layout: Shelf[] = [
    shelf({
      name: "Boutique",
      id: "boutique",
      rules: [{ field: "label", values: ["Criterion"] }],
      sort: [{ key: "spine" }, { key: "title" }],
    }),
    shelf({
      name: "4K",
      id: "4k",
      rules: [
        { field: "format", values: ["4K UHD"] },
        { field: "mediaType", values: ["Movie"] },
      ],
    }),
    shelf({
      name: "BD",
      id: "bd",
      rules: [
        { field: "format", values: ["Blu-ray"] },
        { field: "mediaType", values: ["Movie"] },
      ],
    }),
    shelf({
      name: "DVD",
      id: "dvd",
      rules: [
        { field: "format", values: ["DVD"] },
        { field: "mediaType", values: ["Movie"] },
      ],
    }),
    shelf({
      name: "TV",
      id: "tv",
      rules: [{ field: "mediaType", values: ["TV"] }],
    }),
  ]

  const films = [plainBd, tvDvd, criterion4k, plain4k, plainDvd, criterionBd]

  it("reproduces the boutique/format/TV partition, first match wins", () => {
    const { byShelf, unshelved } = assignFilms(films, layout)
    // The boutique shelf outranks the 4K shelf for a Criterion 4K, and
    // spine-first sort puts #1227 before #1259.
    expect(byShelf.get("boutique")!.map((f) => f.title)).toEqual([
      "Risky Business",
      "Anora",
    ])
    expect(byShelf.get("4k")!.map((f) => f.title)).toEqual(["Dune"])
    expect(byShelf.get("bd")!.map((f) => f.title)).toEqual(["Rush"])
    expect(byShelf.get("dvd")!.map((f) => f.title)).toEqual(["Big Fish"])
    expect(byShelf.get("tv")!.map((f) => f.title)).toEqual(["Succession"])
    expect(unshelved).toEqual([])
  })

  it("sends films matching nothing to the unshelved tray", () => {
    const vhs = filmFixture({ title: "Odd One", format: "VHS" })
    const { unshelved } = assignFilms([vhs], layout)
    expect(unshelved.map((f) => f.title)).toEqual(["Odd One"])
  })

  it("pins beat rules, exclusions push to the next match", () => {
    const withOverrides: Shelf[] = [
      { ...layout[0], pinned: [plain4k.id] },
      { ...layout[1], excluded: [criterion4k.id] },
      ...layout.slice(2),
    ]
    const { byShelf } = assignFilms([plain4k, criterion4k], withOverrides)
    // Dune is pinned to Boutique even though its rules don't match; the
    // excluded Criterion 4K still lands on Boutique via rules (pin test),
    // so exclude it there too to see it fall through to nothing.
    expect(byShelf.get("boutique")!.map((f) => f.title)).toContain("Dune")

    const excludedEverywhere = layout.map((s) => ({
      ...s,
      excluded: [criterion4k.id],
    }))
    const result = assignFilms([criterion4k], excludedEverywhere)
    expect(result.unshelved.map((f) => f.title)).toEqual(["Risky Business"])
  })
})

describe("ordering", () => {
  it("multi-level sorts with nulls last regardless of direction", () => {
    const s = shelf({
      name: "S",
      sort: [{ key: "year", dir: "desc" }, { key: "title" }],
    })
    const ordered = orderShelfFilms(s, [
      filmFixture({ title: "Old", year: 1990 }),
      filmFixture({ title: "Unknown", year: null }),
      filmFixture({ title: "New", year: 2024 }),
      filmFixture({ title: "Also New", year: 2024 }),
    ])
    expect(ordered.map((f) => f.title)).toEqual([
      "Also New",
      "New",
      "Old",
      "Unknown",
    ])
  })

  it("groups contiguously by label with ungrouped films last", () => {
    const s = shelf({ name: "S", groupBy: "label" })
    const ordered = orderShelfFilms(s, [
      filmFixture({ title: "Zed", label: "Arrow" }),
      filmFixture({ title: "Mid", label: null }),
      filmFixture({ title: "Ace", label: "MUBI" }),
      filmFixture({ title: "Bee", label: "Arrow" }),
    ])
    expect(ordered.map((f) => f.title)).toEqual(["Bee", "Zed", "Ace", "Mid"])
  })

  it("manual order pulls listed ids to the front, rest stay sorted", () => {
    const a = filmFixture({ title: "Alpha" })
    const b = filmFixture({ title: "Beta" })
    const c = filmFixture({ title: "Gamma" })
    const s = shelf({ name: "S", manualOrder: [c.id, a.id] })
    expect(orderShelfFilms(s, [a, b, c]).map((f) => f.title)).toEqual([
      "Gamma",
      "Alpha",
      "Beta",
    ])
  })
})

describe("capacity and arranging", () => {
  it("flags films past capacity as the spill", () => {
    const s = shelf({ name: "S", capacity: 2 })
    const ordered = orderShelfFilms(s, [
      filmFixture({ title: "A" }),
      filmFixture({ title: "B" }),
      filmFixture({ title: "C" }),
    ])
    expect(shelfOverflow(s, ordered).map((f) => f.title)).toEqual(["C"])
    expect(shelfOverflow(shelf({ name: "N" }), ordered)).toEqual([])
  })

  it("flags films added after the shelf was arranged", () => {
    const s = shelf({ name: "S", arrangedAt: "2026-06-01T00:00:00Z" })
    expect(
      isNewSinceArranged(
        s,
        filmFixture({ title: "New", createdAt: new Date("2026-07-01") })
      )
    ).toBe(true)
    expect(
      isNewSinceArranged(
        s,
        filmFixture({ title: "Old", createdAt: new Date("2026-05-01") })
      )
    ).toBe(false)
    expect(
      isNewSinceArranged(
        shelf({ name: "Never" }),
        filmFixture({ title: "Any" })
      )
    ).toBe(false)
  })
})

describe("wishlist ghosts", () => {
  const wish = (overrides: Partial<WishlistItem> & { title: string }) => ({
    id: `wish-${overrides.title}`,
    userId: "u1",
    director: null,
    year: null,
    format: null,
    url: null,
    retailer: null,
    price: null,
    coverUrl: null,
    notes: null,
    createdAt: new Date("2026-01-01"),
    ...overrides,
  })

  it("assigns ghosts only to shelves whose rules a wishlist item can satisfy", () => {
    const shelves = [
      shelf({
        name: "Boutique",
        id: "boutique",
        rules: [{ field: "label", values: ["Criterion"] }],
      }),
      shelf({
        name: "4K",
        id: "4k",
        rules: [{ field: "format", values: ["4K UHD"] }],
      }),
    ]
    const byShelf = assignWishlist(
      [wish({ title: "Heat", format: "4K UHD" }), wish({ title: "No Format" })],
      shelves
    )
    // Label rules can't be evaluated for wishlist items, so the boutique
    // shelf hosts no ghosts and the un-formatted item matches nothing.
    expect(byShelf.get("boutique")).toBeUndefined()
    expect(byShelf.get("4k")!.map((i) => i.title)).toEqual(["Heat"])
  })

  it("computes the alphabetical insertion slot for a ghost", () => {
    const ordered = [
      filmFixture({ title: "Alien" }),
      filmFixture({ title: "Dune" }),
      filmFixture({ title: "Zodiac" }),
    ]
    expect(ghostInsertionIndex(ordered, wish({ title: "The Batman" }))).toBe(1)
    expect(ghostInsertionIndex(ordered, wish({ title: "Zulu" }))).toBe(3)
  })
})

describe("templates", () => {
  const collection = [
    filmFixture({ title: "Anora", label: "Criterion", spineNumber: 1259 }),
    filmFixture({ title: "Queer", label: "MUBI", format: "4K UHD" }),
    filmFixture({
      title: "Flow",
      label: "Curzon Film World",
      format: "4K UHD",
    }),
    filmFixture({ title: "Dune", label: "Warner Bros.", format: "4K UHD" }),
    filmFixture({ title: "Rush", label: "Studio Canal" }),
    filmFixture({ title: "Succession", format: "DVD", tmdbMediaType: "tv" }),
  ]

  it("finds boutique labels loosely, including expanded names", () => {
    expect(boutiqueLabelsIn(collection)).toEqual([
      "Criterion",
      "Curzon Film World",
      "MUBI",
    ])
  })

  it("boutique template partitions like the classic collector layout", () => {
    let n = 0
    const shelves = buildTemplateShelves(
      "boutique",
      collection,
      () => `t${++n}`
    )
    expect(shelves.map((s) => s.name)).toEqual([
      "Boutique editions",
      "4K UHD",
      "Blu-ray",
      "DVD",
      "TV box sets",
    ])
    const { byShelf, unshelved } = assignFilms(collection, shelves)
    const names = Object.fromEntries(shelves.map((s) => [s.name, s.id]))
    expect(
      byShelf.get(names["Boutique editions"])!.map((f) => f.title)
    ).toEqual(
      // Spine-first sort: Anora (#1259) leads, the rest alphabetical.
      ["Anora", "Flow", "Queer"]
    )
    expect(byShelf.get(names["4K UHD"])!.map((f) => f.title)).toEqual(["Dune"])
    expect(byShelf.get(names["Blu-ray"])!.map((f) => f.title)).toEqual(["Rush"])
    expect(byShelf.get(names["DVD"])!.map((f) => f.title)).toEqual([])
    expect(byShelf.get(names["TV box sets"])!.map((f) => f.title)).toEqual([
      "Succession",
    ])
    expect(unshelved).toEqual([])
  })

  it("omits the boutique shelf when no boutique labels exist", () => {
    const shelves = buildTemplateShelves("boutique", [
      filmFixture({ title: "Rush" }),
    ])
    expect(shelves.map((s) => s.name)).toEqual([
      "4K UHD",
      "Blu-ray",
      "DVD",
      "TV box sets",
    ])
  })
})
