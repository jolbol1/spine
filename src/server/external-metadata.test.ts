import { afterEach, describe, expect, it, vi } from "vitest"
import { env } from "@/env"
import {
  parseBlurayProductHtml,
  parseBluraySearchResponse,
} from "@/server/bluray"
import { parseCexResponse } from "@/server/cex"
import {
  extractReviewFromPage,
  parseDiaryPage,
  reviewFromRssDescription,
} from "@/server/letterboxd"
import { fetchRtScores } from "@/server/rottentomatoes"
import { fetchTmdbById, searchTmdbTitles } from "@/server/tmdb"
import { detectRetailer, extractPrice } from "@/server/wishlist"

afterEach(() => {
  vi.unstubAllGlobals()
  env.TMDB_API_KEY = undefined
})

describe("external metadata fixtures", () => {
  it("maps a Blu-ray.com quicksearch response", () => {
    expect(
      parseBluraySearchResponse({
        items: [
          {
            title: "Paris &amp; Texas",
            year: "1984",
            url: "https://m.blu-ray.com/movies/paris-texas/1/",
            cover: "https://images.example/poster_small.jpg",
            flag: "gb.png",
            reldate: "2026-01-01",
          },
          { title: "Incomplete" },
        ],
      })
    ).toEqual([
      {
        title: "Paris & Texas",
        year: 1984,
        url: "https://www.blu-ray.com/movies/paris-texas/1/",
        coverUrl: "https://images.example/poster_front.jpg",
        countryFlag: "gb.png",
        releaseDate: "2026-01-01",
      },
    ])
  })

  it("parses a full Blu-ray.com product page", () => {
    const html = `
      <title>Fixture Film 4K Blu-ray (2024)</title>
      <a href="movies.php?year=2024">2024</a>
      Director: <a>Ren&#233; Director</a>
      <a href="movies.php?studioid=9">Criterion</a>
      <div id="shortaudio">English: Dolby Atmos<br></div>
      HDR: Dolby Vision, HDR10<br>
      Region A, B
      Spine #123
      <span>121 min</span>
      Three-disc set
      <meta property="og:image" content="https://images.example/fixture_large.jpg">
      Resolution: 2160p
    `
    expect(
      parseBlurayProductHtml(
        html,
        new URL("https://www.blu-ray.com/movies/fixture/1/")
      )
    ).toEqual({
      title: "Fixture Film",
      year: 2024,
      director: "René Director",
      format: "4K UHD",
      audio: "English: Dolby Atmos",
      hdr: "Dolby Vision, HDR10",
      region: "A, B",
      label: "Criterion",
      spineNumber: 123,
      runtimeMinutes: 121,
      discCount: 3,
      coverUrl: "https://images.example/fixture_front.jpg",
      url: "https://www.blu-ray.com/movies/fixture/1/",
    })
  })

  it("parses CEX box details", () => {
    expect(
      parseCexResponse(
        {
          response: {
            data: {
              boxDetails: [
                {
                  boxName: "Simpsons Movie, The (PG)",
                  superCatName: "Film",
                  categoryName: "Blu-Ray",
                  imageUrls: { large: "https://images.example/a cover.jpg" },
                  attributeInfo: [
                    {
                      attributeName: "year_of_production",
                      attributeValue: "2007",
                    },
                    { attributeName: "duration", attributeValue: "87" },
                    {
                      attributeName: "genre",
                      attributeValue: ["Animation", "Comedy"],
                    },
                    { attributeName: "cert_uk", attributeValue: "PG" },
                  ],
                },
              ],
            },
          },
        },
        "5055002555165"
      )
    ).toMatchObject({
      title: "The Simpsons Movie",
      year: 2007,
      format: "Blu-ray",
      runtimeMinutes: 87,
      bbfcRating: "PG",
      genres: ["Animation", "Comedy"],
      coverUrl: "https://images.example/a%20cover.jpg",
      barcode: "5055002555165",
    })
  })

  it("extracts retailer identity and the product-adjacent price", () => {
    expect(detectRetailer("https://shop.bfi.org.uk/products/test")).toBe("BFI")
    expect(
      extractPrice(
        "Sale banner £5.00\n# Fixture Release\n\nFixture Release now £24.99",
        "Fixture Release"
      )
    ).toBe("£24.99")
  })

  it("scrapes Rotten Tomatoes search and score fixtures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input)
        if (url.includes("/search?")) {
          return new Response(
            `<search-page-media-row release-year="1982"><a href="https://www.rottentomatoes.com/m/the_thing_1982" slot="title">The Thing</a></search-page-media-row>`
          )
        }
        return new Response(
          `<script>{"criticsScore":{"score":85},"audienceScore":{"score":"92"}}</script>`
        )
      })
    )

    await expect(fetchRtScores("The Thing", 1982, "movie")).resolves.toEqual({
      url: "https://www.rottentomatoes.com/m/the_thing_1982",
      criticsScore: 85,
      audienceScore: 92,
    })
  })

  it("maps TMDB detail and search fixtures", async () => {
    env.TMDB_API_KEY = "fixture-key"
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input)
        if (url.includes("/search/multi")) {
          return Response.json({
            results: [
              {
                id: 60573,
                media_type: "tv",
                name: "Silicon Valley",
                first_air_date: "2014-04-06",
                poster_path: "/poster.jpg",
              },
              { id: 1, media_type: "person", name: "Ignored" },
            ],
          })
        }
        return Response.json({
          imdb_id: "tt0133093",
          genres: [{ name: "Science Fiction" }],
          production_companies: [{ name: "Warner Bros." }],
          production_countries: [{ name: "United States" }],
          original_language: "en",
          budget: 63_000_000,
          revenue: 467_000_000,
          vote_average: 8.2,
          belongs_to_collection: { name: "The Matrix Collection" },
          poster_path: "/matrix.jpg",
          release_dates: {
            results: [
              { iso_3166_1: "GB", release_dates: [{ certification: "15" }] },
            ],
          },
          credits: {
            cast: [
              {
                id: 1,
                name: "Keanu Reeves",
                character: "Neo",
                profile_path: null,
              },
            ],
            crew: [{ name: "Lana Wachowski", job: "Director" }],
          },
        })
      })
    )

    await expect(fetchTmdbById(603, "movie")).resolves.toMatchObject({
      tmdbId: 603,
      mediaType: "movie",
      directors: ["Lana Wachowski"],
      cast: [{ name: "Keanu Reeves", character: "Neo" }],
      details: {
        imdbId: "tt0133093",
        genres: ["Science Fiction"],
        certification: "15",
      },
    })
    await expect(searchTmdbTitles("Silicon Valley")).resolves.toEqual([
      {
        tmdbId: 60573,
        mediaType: "tv",
        title: "Silicon Valley",
        year: 2014,
        posterUrl: "https://image.tmdb.org/t/p/w342/poster.jpg",
      },
    ])
  })

  it("parses Letterboxd RSS, diary, and review fixtures", () => {
    expect(
      reviewFromRssDescription(
        '<p><img src="poster.jpg"></p><p>A &amp; B review.</p><p>Watched on Friday.</p>'
      )
    ).toBe("A & B review.")

    const entries = new Map()
    expect(
      parseDiaryPage(
        `class="diary-entry-row" data-item-name="Paris, Texas (1984)" data-item-slug="paris-texas"><a class="daydate" href="/user/diary/films/for/2024/05/06/">6</a><span class="rating rated-9">rating</span><span class="icon-liked"></span><td class="col-review"><a href="/user/film/paris-texas/1/" class="icon-review">review</a></td>`,
        "user",
        entries
      )
    ).toBe(1)
    expect(entries.get("paris-texas")).toMatchObject({
      title: "Paris, Texas",
      year: 1984,
      rating: 4.5,
      liked: true,
      reviewUri: "https://letterboxd.com/user/film/paris-texas/1/",
    })
    expect(
      extractReviewFromPage(
        '<div class="js-review-body"><p>First line.</p><p>Second &amp; final.</p></div>'
      )
    ).toBe("First line.\n\nSecond & final.")
  })
})
