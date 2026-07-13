import { describe, expect, it } from "vitest"
import { dedupeTmdbTitleMatches } from "@/lib/tmdb-title-matches"

describe("dedupeTmdbTitleMatches", () => {
  it("keeps movie and TV matches that share a numeric TMDB ID", () => {
    const movie = { tmdbId: 42, mediaType: "movie" as const }
    const tv = { tmdbId: 42, mediaType: "tv" as const }

    expect(dedupeTmdbTitleMatches([movie, tv, movie])).toEqual([movie, tv])
  })
})
