import { describe, expect, it } from "vitest"
import { importBlurayProduct } from "@/server/bluray"
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
})
