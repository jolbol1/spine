import { describe, expect, it } from "vitest"
import type { Film, Shelf, WishlistItem } from "@/db/schema"
import { toSortTitle } from "./film-helpers"
import {
  assignFilms,
  assignWishlist,
  boutiqueLabelsIn,
  buildTemplateShelves,
  ghostInsertionIndex,
  isNewSinceArranged,
  matchesShelfRules,
  orderShelfFilms,
  shelfFieldOptions,
  shelfOverflow,
} from "./shelves"

let nextId = 0

function film(overrides: Partial<Film> & { title: string }): Film {
  return {
    id: `film-${++nextId}-${overrides.title}`,
    userId: "u1",
    sortTitle: toSortTitle(overrides.title),
    director: null,
    year: 2000,
    format: "Blu-ray",
    audio: null,
    hdr: null,
    region: null,
    label: null,
    edition: null,
    packageType: null,
    spineNumber: null,
    runtimeMinutes: null,
    discCount: 1,
    barcode: null,
    coverUrl: null,
    notes: null,
    pricePaid: null,
    tmdbId: null,
    tmdbMediaType: "movie",
    tmdbCast: null,
    tmdbDetails: null,
    rtUrl: null,
    rtCriticsScore: null,
    rtAudienceScore: null,
    rtSyncedAt: null,
    letterboxdWatched: false,
    letterboxdWatchedAt: null,
    letterboxdRating: null,
    letterboxdUri: null,
    letterboxdReview: null,
    letterboxdLiked: null,
    watchedOverride: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  }
}

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
        film({ title: "A", label: "Arrow", format: "4K UHD" }),
        s
      )
    ).toBe(true)
    expect(matchesShelfRules(film({ title: "B", label: "Arrow" }), s)).toBe(
      false
    )
    expect(
      matchesShelfRules(
        film({ title: "C", label: "MUBI", format: "4K UHD" }),
        s
      )
    ).toBe(false)
  })

  it("treats unmatched titles as movies and missing HDR as SDR", () => {
    const movie = film({ title: "Mystery", tmdbMediaType: null })
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
    const horror = film({
      title: "It",
      tmdbDetails: { genres: ["Horror", "Thriller"] } as Film["tmdbDetails"],
    })
    const s = shelf({
      name: "Spooky",
      rules: [{ field: "genre", values: ["Horror"] }],
    })
    expect(matchesShelfRules(horror, s)).toBe(true)
    expect(matchesShelfRules(film({ title: "Up" }), s)).toBe(false)
  })

  it("empty rule lists and empty value lists match everything", () => {
    const f = film({ title: "Anything" })
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
  const criterion4k = film({
    title: "Risky Business",
    label: "Criterion",
    format: "4K UHD",
    spineNumber: 1227,
  })
  const criterionBd = film({
    title: "Anora",
    label: "Criterion",
    spineNumber: 1259,
  })
  const plain4k = film({ title: "Dune", format: "4K UHD" })
  const plainBd = film({ title: "Rush" })
  const plainDvd = film({ title: "Big Fish", format: "DVD" })
  const tvDvd = film({
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
    const vhs = film({ title: "Odd One", format: "VHS" })
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
      film({ title: "Old", year: 1990 }),
      film({ title: "Unknown", year: null }),
      film({ title: "New", year: 2024 }),
      film({ title: "Also New", year: 2024 }),
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
      film({ title: "Zed", label: "Arrow" }),
      film({ title: "Mid", label: null }),
      film({ title: "Ace", label: "MUBI" }),
      film({ title: "Bee", label: "Arrow" }),
    ])
    expect(ordered.map((f) => f.title)).toEqual(["Bee", "Zed", "Ace", "Mid"])
  })

  it("manual order pulls listed ids to the front, rest stay sorted", () => {
    const a = film({ title: "Alpha" })
    const b = film({ title: "Beta" })
    const c = film({ title: "Gamma" })
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
      film({ title: "A" }),
      film({ title: "B" }),
      film({ title: "C" }),
    ])
    expect(shelfOverflow(s, ordered).map((f) => f.title)).toEqual(["C"])
    expect(shelfOverflow(shelf({ name: "N" }), ordered)).toEqual([])
  })

  it("flags films added after the shelf was arranged", () => {
    const s = shelf({ name: "S", arrangedAt: "2026-06-01T00:00:00Z" })
    expect(
      isNewSinceArranged(
        s,
        film({ title: "New", createdAt: new Date("2026-07-01") })
      )
    ).toBe(true)
    expect(
      isNewSinceArranged(
        s,
        film({ title: "Old", createdAt: new Date("2026-05-01") })
      )
    ).toBe(false)
    expect(
      isNewSinceArranged(shelf({ name: "Never" }), film({ title: "Any" }))
    ).toBe(false)
  })
})

describe("wishlist ghosts", () => {
  const wish = (overrides: Partial<WishlistItem> & { title: string }) =>
    ({
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
      film({ title: "Alien" }),
      film({ title: "Dune" }),
      film({ title: "Zodiac" }),
    ]
    expect(ghostInsertionIndex(ordered, wish({ title: "The Batman" }))).toBe(1)
    expect(ghostInsertionIndex(ordered, wish({ title: "Zulu" }))).toBe(3)
  })
})

describe("templates", () => {
  const collection = [
    film({ title: "Anora", label: "Criterion", spineNumber: 1259 }),
    film({ title: "Queer", label: "MUBI", format: "4K UHD" }),
    film({ title: "Flow", label: "Curzon Film World", format: "4K UHD" }),
    film({ title: "Dune", label: "Warner Bros.", format: "4K UHD" }),
    film({ title: "Rush", label: "Studio Canal" }),
    film({ title: "Succession", format: "DVD", tmdbMediaType: "tv" }),
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
    const shelves = buildTemplateShelves("boutique", [film({ title: "Rush" })])
    expect(shelves.map((s) => s.name)).toEqual([
      "4K UHD",
      "Blu-ray",
      "DVD",
      "TV box sets",
    ])
  })

  it("lists field options with counts", () => {
    expect(shelfFieldOptions(collection, "format")).toEqual([
      ["4K UHD", 3],
      ["Blu-ray", 2],
      ["DVD", 1],
    ])
  })
})
