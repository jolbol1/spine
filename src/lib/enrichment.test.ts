import { describe, expect, it } from "vitest"
import type {
  DiscEnrichment,
  EnrichmentSources,
  TmdbEnrichment,
} from "@/lib/enrichment"
import { mergeEnrichment } from "@/lib/enrichment"
import {
  castMemberFixture,
  filmFixture,
  tmdbDetailsFixture,
} from "@/test/film-fixture"

/** A TMDB match, with the part each test cares about supplied as overrides. */
const tmdbMatch = (
  overrides: Partial<TmdbEnrichment> = {}
): TmdbEnrichment => ({
  tmdbId: 774,
  mediaType: "movie",
  directors: [],
  posterUrl: null,
  cast: [],
  details: null,
  ...overrides,
})

describe("filling blank fields", () => {
  it("fills a blank director from the metadata source", () => {
    const film = filmFixture({ director: null })

    const patch = mergeEnrichment(film, {
      tmdb: tmdbMatch({ directors: ["Lana Wachowski", "Lilly Wachowski"] }),
    })

    expect(patch.director).toBe("Lana Wachowski, Lilly Wachowski")
  })

  it("treats a field left empty as blank", () => {
    const film = filmFixture({ director: "   " })

    const patch = mergeEnrichment(film, {
      tmdb: tmdbMatch({ directors: ["Chantal Akerman"] }),
    })

    expect(patch.director).toBe("Chantal Akerman")
  })
})

describe("protecting what the user set", () => {
  it("never overwrites a director the user typed", () => {
    const film = filmFixture({ director: "Powell & Pressburger" })

    const patch = mergeEnrichment(film, {
      tmdb: tmdbMatch({ directors: ["Michael Powell"] }),
    })

    expect(patch).not.toHaveProperty("director")
  })
})

describe("source precedence", () => {
  it("prefers the disc source over the metadata source", () => {
    const film = filmFixture({ director: null, coverUrl: null })

    const patch = mergeEnrichment(film, {
      disc: {
        director: "Michael Powell & Emeric Pressburger",
        coverUrl: "https://images.blu-ray.com/red-shoes.jpg",
      },
      tmdb: tmdbMatch({
        directors: ["Michael Powell"],
        posterUrl: "https://image.tmdb.org/t/p/w500/red-shoes.jpg",
      }),
    })

    expect(patch.director).toBe("Michael Powell & Emeric Pressburger")
    expect(patch.coverUrl).toBe("https://images.blu-ray.com/red-shoes.jpg")
  })

  it("falls through to the metadata source for a field the disc source lacks", () => {
    const film = filmFixture({ director: null, coverUrl: null })

    const patch = mergeEnrichment(film, {
      disc: { director: null, coverUrl: null },
      tmdb: tmdbMatch({
        directors: ["Michael Powell"],
        posterUrl: "https://image.tmdb.org/t/p/w500/red-shoes.jpg",
      }),
    })

    expect(patch.director).toBe("Michael Powell")
    expect(patch.coverUrl).toBe("https://image.tmdb.org/t/p/w500/red-shoes.jpg")
  })
})

describe("review scores", () => {
  const NOW = new Date("2026-08-15T09:00:00Z")
  const merge = (
    film: Parameters<typeof mergeEnrichment>[0],
    sources: EnrichmentSources
  ) => mergeEnrichment(film, sources, NOW)

  it("writes the scores a match returned", () => {
    const patch = merge(filmFixture(), {
      rt: {
        url: "https://www.rottentomatoes.com/m/the_red_shoes",
        criticsScore: 100,
        audienceScore: 94,
      },
    })

    expect(patch).toMatchObject({
      rtUrl: "https://www.rottentomatoes.com/m/the_red_shoes",
      rtCriticsScore: 100,
      rtAudienceScore: 94,
      rtSyncedAt: NOW,
    })
  })

  it("records an unmatched lookup as attempted and clears stale scores", () => {
    const film = filmFixture({
      rtUrl: "https://www.rottentomatoes.com/m/wrong_title",
      rtCriticsScore: 71,
      rtAudienceScore: 68,
    })

    const patch = merge(film, { rt: null })

    expect(patch).toMatchObject({
      rtUrl: null,
      rtCriticsScore: null,
      rtAudienceScore: null,
      rtSyncedAt: NOW,
    })
  })

  it("leaves the scores alone when no lookup ran", () => {
    const patch = merge(filmFixture(), { tmdb: tmdbMatch() })

    expect(patch).not.toHaveProperty("rtSyncedAt")
    expect(patch).not.toHaveProperty("rtUrl")
  })
})

describe("metadata the source owns", () => {
  it("writes the match's identifiers, cast and details", () => {
    const cast = [castMemberFixture({ name: "Moira Shearer" })]
    const details = tmdbDetailsFixture({ genres: ["Drama"] })

    const patch = mergeEnrichment(filmFixture(), {
      tmdb: tmdbMatch({ tmdbId: 774, mediaType: "movie", cast, details }),
    })

    expect(patch).toMatchObject({
      tmdbId: 774,
      tmdbMediaType: "movie",
      tmdbCast: cast,
      tmdbDetails: details,
    })
  })

  it("refreshes a match the film already has", () => {
    const film = filmFixture({ tmdbId: 111, tmdbCast: [] })

    const patch = mergeEnrichment(film, {
      tmdb: tmdbMatch({ tmdbId: 774, cast: [castMemberFixture()] }),
    })

    expect(patch.tmdbId).toBe(774)
    expect(patch.tmdbCast).toHaveLength(1)
  })

  it("keeps stored details when the source returned none", () => {
    const film = filmFixture({ tmdbDetails: tmdbDetailsFixture() })

    const patch = mergeEnrichment(film, { tmdb: tmdbMatch({ details: null }) })

    expect(patch).not.toHaveProperty("tmdbDetails")
  })

  it("writes nothing when the metadata source matched nothing", () => {
    const patch = mergeEnrichment(filmFixture({ director: null }), {
      tmdb: null,
    })

    expect(patch).toEqual({})
  })
})

describe("the spine lookup", () => {
  it("fills a blank spine number", () => {
    const patch = mergeEnrichment(filmFixture({ spineNumber: null }), {
      criterionSpine: 44,
    })

    expect(patch.spineNumber).toBe(44)
  })

  it("leaves a spine number the user set alone", () => {
    const patch = mergeEnrichment(filmFixture({ spineNumber: 141 }), {
      criterionSpine: 44,
    })

    expect(patch).not.toHaveProperty("spineNumber")
  })

  it("prefers a spine number the disc source carried", () => {
    const patch = mergeEnrichment(filmFixture({ spineNumber: null }), {
      disc: { spineNumber: 141 },
      criterionSpine: 44,
    })

    expect(patch.spineNumber).toBe(141)
  })
})

/**
 * The fill-but-never-overwrite rule, asserted column by column. A column a
 * source can fill belongs in this table; one the merge must leave alone does
 * not, and the last case here proves the merge covers exactly this list.
 */
const FILLABLE_CASES: Array<{
  field: keyof DiscEnrichment
  stored: string | number
  fetched: string | number
}> = [
  { field: "director", stored: "Agnès Varda", fetched: "Jacques Demy" },
  { field: "year", stored: 1962, fetched: 1961 },
  {
    field: "coverUrl",
    stored: "https://mine/a.jpg",
    fetched: "https://src/b.jpg",
  },
  { field: "runtimeMinutes", stored: 90, fetched: 133 },
  { field: "spineNumber", stored: 141, fetched: 44 },
  { field: "label", stored: "Criterion", fetched: "Arrow" },
  { field: "edition", stored: "Limited Edition", fetched: "Standard" },
  { field: "packageType", stored: "Steelbook", fetched: "Digipack" },
  { field: "audio", stored: "LPCM 2.0", fetched: "DTS-HD MA 5.1" },
  { field: "hdr", stored: "Dolby Vision", fetched: "HDR10" },
  { field: "region", stored: "B", fetched: "A" },
  { field: "barcode", stored: "5060000000001", fetched: "5060000000002" },
]

describe("every fillable column", () => {
  it.each(FILLABLE_CASES)("fills a blank $field", ({ field, fetched }) => {
    const film = filmFixture({ [field]: null })

    const patch = mergeEnrichment(film, { disc: { [field]: fetched } })

    expect(patch[field]).toBe(fetched)
  })

  it.each(FILLABLE_CASES)(
    "never overwrites a $field the user set",
    ({ field, stored, fetched }) => {
      const film = filmFixture({ [field]: stored })

      const patch = mergeEnrichment(film, { disc: { [field]: fetched } })

      expect(patch).not.toHaveProperty(field)
    }
  )

  it("fills nothing the table does not list", () => {
    const blank = Object.fromEntries(
      FILLABLE_CASES.map(({ field }) => [field, null])
    )
    const film = filmFixture(blank)

    const patch = mergeEnrichment(film, {
      disc: Object.fromEntries(
        FILLABLE_CASES.map(({ field, fetched }) => [field, fetched])
      ),
    })

    expect(Object.keys(patch).sort()).toEqual(
      FILLABLE_CASES.map(({ field }) => field).sort()
    )
  })
})

describe("nothing to write", () => {
  it("returns an empty patch when no source was asked", () => {
    expect(mergeEnrichment(filmFixture({ director: null }), {})).toEqual({})
  })

  it("returns an empty patch when every source matched nothing", () => {
    const patch = mergeEnrichment(filmFixture({ director: null }), {
      disc: null,
      tmdb: null,
      criterionSpine: null,
    })

    expect(patch).toEqual({})
  })
})
