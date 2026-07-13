import { describe, expect, it } from "vitest"
import type { Film } from "@/db/schema"
import {
  cleanBlurayTitle,
  emptyFilmValues,
  filmToValues,
  valuesToInput,
} from "./film-form"

describe("film form boundary", () => {
  it("normalizes optional values, exact prices, SDR, and typed TMDB URLs", () => {
    expect(
      valuesToInput({
        ...emptyFilmValues,
        title: "  Test Film  ",
        director: "",
        year: "2024",
        hdr: "SDR",
        runtimeMinutes: "123 minutes",
        discCount: "",
        pricePaid: "£1,234.50",
        tmdbId: "https://www.themoviedb.org/tv/60573-silicon-valley",
      })
    ).toMatchObject({
      title: "  Test Film  ",
      director: null,
      year: 2024,
      hdr: null,
      runtimeMinutes: 123,
      discCount: 1,
      pricePaid: 1234.5,
      tmdbId: 60573,
      tmdbMediaType: "tv",
    })
  })

  it("assumes no media type for a bare positive TMDB id", () => {
    expect(
      valuesToInput({ ...emptyFilmValues, title: "Test", tmdbId: "603" })
    ).toMatchObject({ tmdbId: 603, tmdbMediaType: null })
    expect(
      valuesToInput({ ...emptyFilmValues, title: "Test", tmdbId: "-1" })
    ).toMatchObject({ tmdbId: null, tmdbMediaType: null })
  })

  it("round-trips stored nullable metadata into editable strings", () => {
    const film = {
      title: "Stored Film",
      director: null,
      year: 1999,
      format: "DVD",
      audio: null,
      hdr: null,
      region: "2",
      label: null,
      edition: null,
      packageType: "Digipack",
      spineNumber: null,
      runtimeMinutes: 100,
      discCount: 2,
      barcode: null,
      coverUrl: null,
      notes: null,
      pricePaid: "9.50",
      tmdbId: 603,
      tmdbMediaType: "movie",
    } as Film

    expect(filmToValues(film)).toEqual({
      ...emptyFilmValues,
      title: "Stored Film",
      year: "1999",
      format: "DVD",
      region: "2",
      packageType: "Digipack",
      runtimeMinutes: "100",
      discCount: "2",
      pricePaid: "9.50",
      tmdbId: "movie/603",
    })
  })

  it("removes Blu-ray.com parenthetical suffixes without joining words", () => {
    expect(cleanBlurayTitle("Dune (2021) (4K Ultra HD)")).toBe("Dune")
    expect(cleanBlurayTitle("Brazil (The Criterion Collection) UK")).toBe(
      "Brazil UK"
    )
  })
})
