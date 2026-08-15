import { describe, expect, it } from "vitest"
import { filmFixture, tmdbDetailsFixture } from "@/test/film-fixture"
import { FILM_FIELDS, filmFieldOptions, filmFieldValues } from "./film-fields"

/**
 * The projection has one set of rules and three callers — shelf rules,
 * collection filters and the statistics tallies. These assertions are the
 * coverage for all three: each caller only asks the questions below.
 */

describe("field values", () => {
  it("reads the plain disc fields", () => {
    const film = filmFixture({
      format: "4K UHD",
      label: "Criterion",
      edition: "Director's cut",
      packageType: "Steelbook",
      region: "B",
    })
    expect(filmFieldValues(film, "format")).toEqual(["4K UHD"])
    expect(filmFieldValues(film, "label")).toEqual(["Criterion"])
    expect(filmFieldValues(film, "edition")).toEqual(["Director's cut"])
    expect(filmFieldValues(film, "packageType")).toEqual(["Steelbook"])
    expect(filmFieldValues(film, "region")).toEqual(["B"])
  })

  it("gives an unrecorded field no value at all", () => {
    const film = filmFixture({
      label: null,
      edition: null,
      packageType: null,
      region: null,
      year: null,
      tmdbDetails: null,
    })
    expect(filmFieldValues(film, "label")).toEqual([])
    expect(filmFieldValues(film, "edition")).toEqual([])
    expect(filmFieldValues(film, "packageType")).toEqual([])
    expect(filmFieldValues(film, "region")).toEqual([])
    expect(filmFieldValues(film, "decade")).toEqual([])
    expect(filmFieldValues(film, "genre")).toEqual([])
  })

  it("treats a blank value as no value at all", () => {
    const film = filmFixture({ format: "", label: "" })
    expect(filmFieldValues(film, "format")).toEqual([])
    expect(filmFieldValues(film, "label")).toEqual([])
    expect(filmFieldOptions([film], "format")).toEqual([])
  })

  it("counts a film with no HDR recorded as SDR", () => {
    expect(filmFieldValues(filmFixture({ hdr: null }), "hdr")).toEqual(["SDR"])
    expect(filmFieldValues(filmFixture({ hdr: "HDR10" }), "hdr")).toEqual([
      "HDR10",
    ])
  })

  it("counts an unmatched title as a movie", () => {
    expect(
      filmFieldValues(filmFixture({ tmdbMediaType: null }), "mediaType")
    ).toEqual(["Movie"])
    expect(
      filmFieldValues(filmFixture({ tmdbMediaType: "tv" }), "mediaType")
    ).toEqual(["TV"])
  })

  it("derives the decade from the release year", () => {
    expect(filmFieldValues(filmFixture({ year: 1999 }), "decade")).toEqual([
      "1990s",
    ])
    expect(filmFieldValues(filmFixture({ year: 2020 }), "decade")).toEqual([
      "2020s",
    ])
  })

  it("lets the watched override beat the Letterboxd sync", () => {
    const synced = filmFixture({ letterboxdWatched: true })
    expect(filmFieldValues(synced, "watched")).toEqual(["Watched"])
    expect(
      filmFieldValues({ ...synced, watchedOverride: false }, "watched")
    ).toEqual(["Unwatched"])
    expect(
      filmFieldValues(filmFixture({ letterboxdWatched: false }), "watched")
    ).toEqual(["Unwatched"])
  })

  it("returns every genre a film carries", () => {
    const film = filmFixture({
      tmdbDetails: tmdbDetailsFixture({ genres: ["Horror", "Thriller"] }),
    })
    expect(filmFieldValues(film, "genre")).toEqual(["Horror", "Thriller"])
  })

  it("reports whether the title is matched on TMDB", () => {
    expect(filmFieldValues(filmFixture({ tmdbId: 42 }), "tmdb")).toEqual([
      "Matched",
    ])
    expect(filmFieldValues(filmFixture({ tmdbId: null }), "tmdb")).toEqual([
      "No match",
    ])
  })

  it("gives every field a value or an empty list for an empty film", () => {
    const bare = filmFixture({ year: null, tmdbDetails: null })
    for (const { field } of FILM_FIELDS) {
      expect(Array.isArray(filmFieldValues(bare, field))).toBe(true)
    }
  })
})

describe("distinct values with counts", () => {
  const collection = [
    filmFixture({ format: "4K UHD", hdr: "Dolby Vision", year: 2021 }),
    filmFixture({ format: "4K UHD", hdr: null, year: 1999 }),
    filmFixture({ format: "Blu-ray", hdr: null, year: 1995 }),
  ]

  it("sorts by value, numerically aware, for filters and rules", () => {
    expect(filmFieldOptions(collection, "format")).toEqual([
      ["4K UHD", 2],
      ["Blu-ray", 1],
    ])
    expect(filmFieldOptions(collection, "decade")).toEqual([
      ["1990s", 2],
      ["2020s", 1],
    ])
  })

  it("sorts by count, largest first, for the statistics tallies", () => {
    expect(filmFieldOptions(collection, "hdr", "count")).toEqual([
      ["SDR", 2],
      ["Dolby Vision", 1],
    ])
  })

  it("leaves out values no film in the collection has", () => {
    expect(filmFieldOptions(collection, "label")).toEqual([])
    expect(filmFieldOptions([], "format")).toEqual([])
  })

  it("counts a film once per genre it carries", () => {
    const films = [
      filmFixture({
        tmdbDetails: tmdbDetailsFixture({ genres: ["Horror", "Drama"] }),
      }),
      filmFixture({ tmdbDetails: tmdbDetailsFixture({ genres: ["Horror"] }) }),
    ]
    expect(filmFieldOptions(films, "genre", "count")).toEqual([
      ["Horror", 2],
      ["Drama", 1],
    ])
  })
})

describe("the field table", () => {
  it("names every field exactly once", () => {
    const fields = FILM_FIELDS.map((d) => d.field)
    expect(new Set(fields).size).toBe(fields.length)
  })

  it("labels every field for the pickers that render it", () => {
    for (const { label } of FILM_FIELDS) expect(label).not.toBe("")
  })
})
