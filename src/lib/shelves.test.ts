import { describe, expect, it } from "vitest"
import { filmFixture, tmdbDetailsFixture } from "@/test/film-fixture"
import type { Film, Shelf, WishlistItem } from "@/db/schema"
import {
  assignFilms,
  assignWishlist,
  boutiqueLabelsIn,
  buildTemplateShelves,
  clearHandArrangedOrder,
  excludeFilmFromShelf,
  forgetFilms,
  ghostInsertionIndex,
  isNewSinceArranged,
  markShelvesArranged,
  matchesShelfRules,
  moveFilmOnShelf,
  moveShelf,
  moveShelfBefore,
  orderShelfFilms,
  pinFilmToShelf,
  removeShelf,
  shelfFieldOptions,
  shelfOverflow,
  unpinFilm,
  upsertShelf,
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

  it("lists field options with counts", () => {
    expect(shelfFieldOptions(collection, "format")).toEqual([
      ["4K UHD", 3],
      ["Blu-ray", 2],
      ["DVD", 1],
    ])
  })
})

describe("edits", () => {
  const layout: Shelf[] = [
    shelf({
      id: "boutique",
      name: "Boutique",
      rules: [{ field: "label", values: ["Criterion"] }],
    }),
    shelf({
      id: "4k",
      name: "4K",
      rules: [{ field: "format", values: ["4K UHD"] }],
    }),
    shelf({ id: "all", name: "Everything" }),
  ]
  const byId = (shelves: Shelf[], id: string): Shelf =>
    shelves.find((s) => s.id === id)!
  const titlesOn = (shelves: Shelf[], films: Film[], id: string) =>
    assignFilms(films, shelves)
      .byShelf.get(id)!
      .map((f) => f.title)

  const criterion4k = filmFixture({
    title: "Anora",
    label: "Criterion",
    format: "4K UHD",
  })
  const dune = filmFixture({ title: "Dune", format: "4K UHD" })
  const rush = filmFixture({ title: "Rush" })

  describe("pinning", () => {
    it("pins a film to a shelf its rules do not match", () => {
      const next = pinFilmToShelf(layout, rush.id, "boutique")
      expect(byId(next, "boutique").pinned).toEqual([rush.id])
      expect(titlesOn(next, [rush], "boutique")).toEqual(["Rush"])
    })

    it("a new pin removes the pin the film held elsewhere", () => {
      const first = pinFilmToShelf(layout, rush.id, "boutique")
      const second = pinFilmToShelf(first, rush.id, "4k")
      expect(second.filter((s) => s.pinned?.includes(rush.id))).toHaveLength(1)
      expect(byId(second, "4k").pinned).toEqual([rush.id])
      expect(titlesOn(second, [rush], "4k")).toEqual(["Rush"])
      expect(titlesOn(second, [rush], "boutique")).toEqual([])
    })

    it("pinning twice to the same shelf lists the film once", () => {
      const twice = pinFilmToShelf(
        pinFilmToShelf(layout, rush.id, "boutique"),
        rush.id,
        "boutique"
      )
      expect(byId(twice, "boutique").pinned).toEqual([rush.id])
    })

    it("a pin clears an exclusion on the same shelf", () => {
      const excluded = excludeFilmFromShelf(layout, criterion4k.id, "boutique")
      const pinned = pinFilmToShelf(excluded, criterion4k.id, "boutique")
      expect(byId(pinned, "boutique").excluded ?? []).not.toContain(
        criterion4k.id
      )
      expect(titlesOn(pinned, [criterion4k], "boutique")).toEqual(["Anora"])
    })

    it("ignores a pin to a shelf that is not there", () => {
      expect(pinFilmToShelf(layout, rush.id, "gone")).toEqual(layout)
    })

    it("unpinning sends the film back to the first shelf it matches", () => {
      const pinned = pinFilmToShelf(layout, criterion4k.id, "all")
      const free = unpinFilm(pinned, criterion4k.id)
      expect(free.some((s) => s.pinned?.length)).toBe(false)
      expect(titlesOn(free, [criterion4k], "boutique")).toEqual(["Anora"])
    })
  })

  describe("excluding", () => {
    it("sends the film to the next shelf whose rules match", () => {
      const next = excludeFilmFromShelf(layout, criterion4k.id, "boutique")
      expect(titlesOn(next, [criterion4k], "boutique")).toEqual([])
      expect(titlesOn(next, [criterion4k], "4k")).toEqual(["Anora"])
    })

    it("a film excluded everywhere lands in the unshelved tray", () => {
      const nowhere = layout.reduce(
        (shelves, s) => excludeFilmFromShelf(shelves, criterion4k.id, s.id),
        layout
      )
      expect(
        assignFilms([criterion4k], nowhere).unshelved.map((f) => f.title)
      ).toEqual(["Anora"])
    })

    it("excluding drops the pin the film held on that shelf, once", () => {
      const pinned = pinFilmToShelf(layout, rush.id, "boutique")
      const next = excludeFilmFromShelf(
        excludeFilmFromShelf(pinned, rush.id, "boutique"),
        rush.id,
        "boutique"
      )
      expect(byId(next, "boutique").pinned).toBeUndefined()
      expect(byId(next, "boutique").excluded).toEqual([rush.id])
    })
  })

  describe("hand-arranged order", () => {
    const films = [
      filmFixture({ title: "Alpha" }),
      filmFixture({ title: "Beta" }),
      filmFixture({ title: "Gamma" }),
    ]
    const ids = films.map((f) => f.id)

    it("a move saves the whole shelf order by hand", () => {
      const next = moveFilmOnShelf(layout, "all", ids, 0, 1)
      expect(byId(next, "all").manualOrder).toEqual([ids[1], ids[0], ids[2]])
      expect(titlesOn(next, films, "all")).toEqual(["Beta", "Alpha", "Gamma"])
    })

    it("refuses a move past either end", () => {
      expect(moveFilmOnShelf(layout, "all", ids, 0, -1)).toEqual(layout)
      expect(moveFilmOnShelf(layout, "all", ids, 2, 1)).toEqual(layout)
    })

    it("resetting drops back to the shelf sort", () => {
      const arranged = moveFilmOnShelf(layout, "all", ids, 0, 1)
      const reset = clearHandArrangedOrder(arranged, "all")
      expect(byId(reset, "all").manualOrder).toBeUndefined()
      expect(titlesOn(reset, films, "all")).toEqual(["Alpha", "Beta", "Gamma"])
    })

    it("survives a change to how the shelf is sorted", () => {
      const arranged = moveFilmOnShelf(layout, "all", ids, 0, 1)
      const resorted = upsertShelf(arranged, {
        ...byId(arranged, "all"),
        sort: [{ key: "title", dir: "desc" }],
        manualOrder: undefined,
      })
      expect(byId(resorted, "all").manualOrder).toEqual([
        ids[1],
        ids[0],
        ids[2],
      ])
      expect(titlesOn(resorted, films, "all")).toEqual([
        "Beta",
        "Alpha",
        "Gamma",
      ])
    })
  })

  describe("shelves themselves", () => {
    it("adds a shelf it has not seen and replaces one it has", () => {
      const extra = shelf({ id: "dvd", name: "DVD" })
      expect(upsertShelf(layout, extra).map((s) => s.id)).toEqual([
        "boutique",
        "4k",
        "all",
        "dvd",
      ])
      const renamed = upsertShelf(layout, {
        ...byId(layout, "4k"),
        name: "4K UHD",
      })
      expect(renamed.map((s) => s.name)).toEqual([
        "Boutique",
        "4K UHD",
        "Everything",
      ])
    })

    it("keeps pins and the arranged date when the rules change", () => {
      const pinned = markShelvesArranged(
        pinFilmToShelf(layout, rush.id, "4k"),
        ["4k"],
        "2026-06-01T00:00:00.000Z"
      )
      const rewritten = upsertShelf(pinned, {
        ...byId(layout, "4k"),
        rules: [{ field: "format", values: ["DVD"] }],
      })
      expect(byId(rewritten, "4k").pinned).toEqual([rush.id])
      expect(byId(rewritten, "4k").arrangedAt).toBe("2026-06-01T00:00:00.000Z")
    })

    it("removes a shelf", () => {
      expect(removeShelf(layout, "4k").map((s) => s.id)).toEqual([
        "boutique",
        "all",
      ])
      expect(removeShelf(layout, "gone")).toEqual(layout)
    })

    it("moves a shelf one place and stops at the ends", () => {
      expect(moveShelf(layout, "4k", -1).map((s) => s.id)).toEqual([
        "4k",
        "boutique",
        "all",
      ])
      expect(moveShelf(layout, "4k", 1).map((s) => s.id)).toEqual([
        "boutique",
        "all",
        "4k",
      ])
      expect(moveShelf(layout, "boutique", -1)).toEqual(layout)
      expect(moveShelf(layout, "all", 1)).toEqual(layout)
      expect(moveShelf(layout, "gone", 1)).toEqual(layout)
    })

    it("drops a shelf above the shelf it was dropped on", () => {
      expect(
        moveShelfBefore(layout, "all", "boutique").map((s) => s.id)
      ).toEqual(["all", "boutique", "4k"])
      expect(moveShelfBefore(layout, "boutique", "boutique")).toEqual(layout)
      expect(moveShelfBefore(layout, "gone", "4k")).toEqual(layout)
    })

    it("marks only the listed shelves arranged", () => {
      const next = markShelvesArranged(
        layout,
        ["4k"],
        "2026-06-01T00:00:00.000Z"
      )
      expect(byId(next, "4k").arrangedAt).toBe("2026-06-01T00:00:00.000Z")
      expect(byId(next, "boutique").arrangedAt).toBeUndefined()
      expect(
        isNewSinceArranged(
          byId(next, "4k"),
          filmFixture({ title: "Later", createdAt: new Date("2026-07-01") })
        )
      ).toBe(true)
    })
  })

  describe("films the collection no longer has", () => {
    it("forgets a deleted film's pin, exclusion and hand-arranged slot", () => {
      const arranged = moveFilmOnShelf(
        excludeFilmFromShelf(
          pinFilmToShelf(layout, rush.id, "boutique"),
          rush.id,
          "4k"
        ),
        "all",
        [dune.id, rush.id],
        0,
        1
      )
      const next = forgetFilms(arranged, [rush.id])
      expect(next.some((s) => s.pinned?.includes(rush.id))).toBe(false)
      expect(next.some((s) => s.excluded?.includes(rush.id))).toBe(false)
      expect(next.some((s) => s.manualOrder?.includes(rush.id))).toBe(false)
      expect(byId(next, "all").manualOrder).toEqual([dune.id])
    })

    it("leaves the layout as it was when nothing referenced the film", () => {
      const pinned = pinFilmToShelf(layout, rush.id, "boutique")
      expect(forgetFilms(pinned, [dune.id])).toBe(pinned)
      expect(forgetFilms(pinned, [])).toBe(pinned)
    })
  })

  it("keeps the spill and the unshelved tray after an edit", () => {
    const small = shelf({ id: "small", name: "Small", capacity: 1 })
    const edited = pinFilmToShelf(
      pinFilmToShelf([small], criterion4k.id, "small"),
      dune.id,
      "small"
    )
    const vhs = filmFixture({ title: "Odd One", format: "VHS" })
    const { byShelf, unshelved } = assignFilms(
      [criterion4k, dune, vhs],
      edited.map((s) => ({
        ...s,
        rules: [{ field: "format" as const, values: ["Blu-ray"] }],
      }))
    )
    expect(
      shelfOverflow({ ...small, capacity: 1 }, byShelf.get("small")!).map(
        (f) => f.title
      )
    ).toEqual(["Dune"])
    expect(unshelved.map((f) => f.title)).toEqual(["Odd One"])
  })

  it("never changes the layout it was given, so a failed save can undo", () => {
    const before = markShelvesArranged(
      moveFilmOnShelf(
        excludeFilmFromShelf(
          pinFilmToShelf(layout, rush.id, "boutique"),
          dune.id,
          "4k"
        ),
        "all",
        [dune.id, rush.id],
        0,
        1
      ),
      ["all"],
      "2026-06-01T00:00:00.000Z"
    )
    const snapshot = structuredClone(before)

    pinFilmToShelf(before, dune.id, "all")
    unpinFilm(before, rush.id)
    excludeFilmFromShelf(before, rush.id, "all")
    moveFilmOnShelf(before, "all", [dune.id, rush.id], 0, 1)
    clearHandArrangedOrder(before, "all")
    upsertShelf(before, { ...byId(before, "4k"), name: "Renamed" })
    removeShelf(before, "4k")
    moveShelf(before, "4k", -1)
    moveShelfBefore(before, "all", "boutique")
    markShelvesArranged(before, ["boutique"], "2026-07-01T00:00:00.000Z")
    forgetFilms(before, [rush.id, dune.id])

    expect(before).toEqual(snapshot)
  })
})
