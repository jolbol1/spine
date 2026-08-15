import { describe, expect, it } from "vitest"
import {
  importBlurayProduct,
  parseBlurayProductHtml,
  parseBluraySearchResponse,
} from "@/server/bluray"
import { capturedResponse } from "@/test/captured-response"
import { fixtureTransport } from "@/test/fixture-transport"

const PRODUCT = "https://www.blu-ray.com/movies/Amelie-Blu-ray/7813/"
const MISSING = "https://www.blu-ray.com/movies/x/2938/"
const NO_SUCH_MOVIE =
  "https://www.blu-ray.com/movies/No-Such-Film-Blu-ray/999999999/"

describe("Blu-ray.com import", () => {
  it("imports a product page the site serves in ISO-8859-1", async () => {
    const result = await importBlurayProduct(
      PRODUCT,
      fixtureTransport({
        [PRODUCT]: {
          body: capturedResponse("bluray-product-amelie.html.gz"),
        },
      })
    )

    expect(result).toMatchObject({
      success: true,
      data: {
        title: "Amélie",
        year: 2001,
        director: "Jean-Pierre Jeunet",
        format: "Blu-ray",
        label: "Icon Film Distribution",
        audio: "French: DTS-HD Master Audio 5.1 (48kHz, 24-bit)",
        runtimeMinutes: 122,
        coverUrl:
          "https://images.static-bluray.com/movies/covers/7813_front.jpg",
        url: PRODUCT,
      },
    })
  })

  it("imports correct text from a page whose charset label is cut off", async () => {
    // The site declares ISO-8859-1 at byte 2033, so a response that stops at
    // 2048 carries "charset=ISO-885" — the label that used to fail the import.
    const cutOff = capturedResponse("bluray-product-amelie.html.gz").slice(
      0,
      2048
    )

    const result = await importBlurayProduct(
      PRODUCT,
      fixtureTransport({ [PRODUCT]: { body: cutOff } })
    )

    expect(result).toMatchObject({
      success: true,
      data: { title: "Amélie" },
    })
  })

  it("says a page is missing when the site answers 404", async () => {
    const result = await importBlurayProduct(
      MISSING,
      fixtureTransport({
        [MISSING]: {
          status: 404,
          body: capturedResponse("bluray-not-found.html"),
        },
      })
    )

    expect(result).toEqual({
      success: false,
      error: expect.stringMatching(/no page/i),
    })
  })

  it("says a page is missing when the site answers 200 with no such movie", async () => {
    const result = await importBlurayProduct(
      NO_SUCH_MOVIE,
      fixtureTransport({
        [NO_SUCH_MOVIE]: {
          body: capturedResponse("bluray-no-such-movie.html"),
        },
      })
    )

    expect(result).toEqual({
      success: false,
      error: expect.stringMatching(/no page/i),
    })
  })

  it("tells a blocked source apart from a missing page", async () => {
    const blocked = await importBlurayProduct(
      PRODUCT,
      fixtureTransport({ [PRODUCT]: { status: 403, body: "" } })
    )
    const missing = await importBlurayProduct(
      MISSING,
      fixtureTransport({ [MISSING]: { status: 404, body: "" } })
    )

    expect(blocked).toEqual({
      success: false,
      error: expect.stringMatching(/blocking/i),
    })
    expect(missing).not.toEqual(blocked)
  })

  it("refuses a link that is not a Blu-ray.com product page", async () => {
    const result = await importBlurayProduct(
      "https://www.amazon.co.uk/dp/B000123456",
      fixtureTransport({})
    )

    expect(result).toEqual({
      success: false,
      error: expect.stringMatching(/blu-ray\.com/i),
    })
  })

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
})
