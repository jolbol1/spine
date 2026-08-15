import { charsetOf, failureForStatus } from "@/server/page-fetch"
import type { PageTransport } from "@/server/page-fetch"

/** One captured response, keyed by the address it was captured from. */
export interface CapturedPage {
  /** The status the site answered with. Defaults to 200. */
  status?: number
  /** The response body — captured bytes, or text for a page whose encoding is not the point. */
  body: Uint8Array | string
  /** The `Content-Type` header, when the capture carried a character set. */
  contentType?: string
}

/**
 * The test adapter of the outbound page-fetch port: it serves captured
 * responses instead of talking to the network, so a test exercises the same
 * decoding, and the same blocked-versus-missing rules, as production.
 *
 * An address with no capture is a mistake in the test rather than a miss, so
 * it throws instead of reporting the page missing.
 */
export function fixtureTransport(
  pages: Record<string, CapturedPage | undefined>
): PageTransport {
  return async ({ url }) => {
    const page = pages[url]
    if (!page) throw new Error(`No captured response for ${url}`)

    const status = page.status ?? 200
    if (status < 200 || status >= 300) {
      return { ok: false, status: failureForStatus(status) }
    }
    return {
      ok: true,
      bytes:
        typeof page.body === "string"
          ? new TextEncoder().encode(page.body)
          : page.body,
      charset: charsetOf(page.contentType),
      via: "fixture",
    }
  }
}
