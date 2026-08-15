import { describe, expect, it } from "vitest"
import { fetchPage, withFallback } from "@/server/page-fetch"
import { capturedResponse } from "@/test/captured-response"
import { fixtureTransport } from "@/test/fixture-transport"
import type { PageResult } from "@/server/page-fetch"

const PRODUCT = "https://www.blu-ray.com/movies/Amelie-Blu-ray/7813/"
const MISSING = "https://www.blu-ray.com/movies/x/2938/"

/** The captured product page: ISO-8859-1, with its charset label at byte 2033. */
const productBytes = capturedResponse("bluray-product-amelie.html.gz")

function pageOf(result: PageResult) {
  if (!result.ok) throw new Error(`expected a page, got ${result.status}`)
  return result
}

describe("outbound page fetch", () => {
  it("decodes a page in the character set the page declares", async () => {
    const result = await fetchPage(
      { url: PRODUCT, defaultCharset: "utf-8" },
      fixtureTransport({ [PRODUCT]: { body: productBytes } })
    )

    const page = pageOf(result)
    expect(page.charset).toBe("ISO-8859-1")
    expect(page.html).toContain(
      "<title>Amélie Blu-ray (Le Fabuleux destin d'Amélie Poulain) (Australia)</title>"
    )
  })

  it("decodes a response cut off mid-charset-label in the caller's encoding", async () => {
    // The site's label sits at byte 2033, so a body cut at 2048 carries
    // "charset=ISO-885" — a label no decoder accepts.
    const cutOff = productBytes.slice(0, 2048)

    const result = await fetchPage(
      { url: PRODUCT, defaultCharset: "iso-8859-1" },
      fixtureTransport({ [PRODUCT]: { body: cutOff } })
    )

    const page = pageOf(result)
    expect(page.charset).toBe("iso-8859-1")
    expect(page.html).toContain("<title>Amélie Blu-ray")
  })

  it("trusts the character set the transport reports over the page's own label", async () => {
    // What the fallback adapter hands back: the same page, already decoded
    // and re-encoded as UTF-8, still carrying its ISO-8859-1 meta label.
    const asUtf8 = new TextEncoder().encode(
      new TextDecoder("iso-8859-1").decode(productBytes)
    )

    const result = await fetchPage(
      { url: PRODUCT, defaultCharset: "iso-8859-1" },
      fixtureTransport({
        [PRODUCT]: { body: asUtf8, contentType: "text/html; charset=utf-8" },
      })
    )

    const page = pageOf(result)
    expect(page.charset).toBe("utf-8")
    expect(page.html).toContain("<title>Amélie Blu-ray")
  })

  it("lets only a meta tag choose the encoding, not the text of the page", async () => {
    // A feed carrying the word charset= in its content — a Letterboxd review
    // quoting one, say — must not decide how the bytes are read.
    const feed =
      '<?xml version="1.0"?><rss><item><description>charset=iso-8859-1 is a '
    const bytes = new TextEncoder().encode(
      `${feed}café.</description></item></rss>`
    )

    const result = await fetchPage(
      { url: PRODUCT },
      fixtureTransport({ [PRODUCT]: { body: bytes } })
    )

    const page = pageOf(result)
    expect(page.charset).toBe("utf-8")
    expect(page.html).toContain("café")
  })

  it("reports a missing page and a blocked source differently", async () => {
    const transport = fixtureTransport({
      [MISSING]: {
        status: 404,
        body: capturedResponse("bluray-not-found.html"),
      },
      [PRODUCT]: { status: 403, body: "" },
    })

    await expect(fetchPage({ url: MISSING }, transport)).resolves.toEqual({
      ok: false,
      status: "notfound",
    })
    await expect(fetchPage({ url: PRODUCT }, transport)).resolves.toEqual({
      ok: false,
      status: "blocked",
    })
  })

  it("tries the fallback transport when the first one is blocked", async () => {
    const transport = withFallback(
      fixtureTransport({ [PRODUCT]: { status: 403, body: "" } }),
      fixtureTransport({ [PRODUCT]: { body: productBytes } })
    )

    const page = pageOf(await fetchPage({ url: PRODUCT }, transport))
    expect(page.html).toContain("<title>Amélie Blu-ray")
  })

  it("leaves a genuinely missing page missing rather than trying the fallback", async () => {
    const transport = withFallback(
      fixtureTransport({ [MISSING]: { status: 404, body: "" } }),
      fixtureTransport({ [MISSING]: { body: productBytes } })
    )

    await expect(fetchPage({ url: MISSING }, transport)).resolves.toEqual({
      ok: false,
      status: "notfound",
    })
  })

  it("goes straight to the fallback when the caller has already been blocked", async () => {
    const transport = withFallback(
      fixtureTransport({}),
      fixtureTransport({ [PRODUCT]: { body: productBytes } })
    )

    const page = pageOf(
      await fetchPage({ url: PRODUCT, preferFallback: true }, transport)
    )
    expect(page.html).toContain("<title>Amélie Blu-ray")
  })
})
