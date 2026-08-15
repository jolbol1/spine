import { env } from "@/env"
import { errorMessage, serverLogger } from "@/server/log"

const log = serverLogger("page-fetch")

/**
 * The one way out of the application for a web page.
 *
 * Everything a page fetch needs to get right — browser headers, timeouts,
 * turning bytes into text in the encoding the page actually uses, and telling
 * a blocked source apart from a page that is not there — lives here, once.
 * How the bytes arrive is a `PageTransport`, injected by the caller: a direct
 * fetch in production, Firecrawl when a site refuses us, captured responses in
 * tests. Every source scrapes through the same code path as a result, and the
 * test adapter reaches all of it.
 */

export const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

/**
 * Blu-ray.com rejects requests carrying no Accept-Language at all (200 +
 * "error42" body). Node's fetch sends one by default; Bun's — the production
 * runtime — does not, so every outbound call has to send it itself.
 */
export const ACCEPT_LANGUAGE = "en-GB,en;q=0.9"

/** Sources that refuse a bare request answer a browser-shaped one. */
export const BROWSER_HEADERS = {
  "User-Agent": BROWSER_UA,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9",
  "Accept-Language": ACCEPT_LANGUAGE,
}

const DIRECT_TIMEOUT_MS = 15_000
const FIRECRAWL_TIMEOUT_MS = 90_000

/**
 * How far into a page to look for the character set it declares. Blu-ray.com
 * declares itself around byte 2000 and can reach 2600 on a long title, so the
 * window has room to spare; the scan stops at </head> in any case.
 */
const SNIFF_BYTES = 8_192

/** What to read bytes as when nothing usable says otherwise. */
const DEFAULT_CHARSET = "utf-8"

/** Where a page came from. Callers pace themselves by it. */
export type PageSource = "direct" | "firecrawl" | "fixture"

/**
 * Why a page did not arrive. `notfound` means the source answered and has no
 * such page — give up. `blocked` means it refused us — worth another route or
 * another minute. `unreachable` means we never got an answer at all.
 */
export type PageFailure = "notfound" | "blocked" | "unreachable"

export interface PageRequest {
  url: string
  /**
   * The encoding to read the bytes in when the page declares none we can use.
   * Defaults to UTF-8; a source known to serve something else says so here.
   */
  defaultCharset?: string
  /** Skip the primary transport — this run has already been blocked once. */
  preferFallback?: boolean
}

export type TransportResult =
  | {
      ok: true
      bytes: Uint8Array
      /** The encoding the transport knows the bytes to be in, if any. */
      charset: string | null
      via: PageSource
    }
  | { ok: false; status: PageFailure }

/** How the bytes arrive. The seam the port is injected at. */
export type PageTransport = (request: PageRequest) => Promise<TransportResult>

export type PageResult =
  | { ok: true; html: string; charset: string; via: PageSource }
  | { ok: false; status: PageFailure }

/** How every adapter reads a status the source answered with. */
export function failureForStatus(status: number): PageFailure {
  return status === 404 || status === 410 ? "notfound" : "blocked"
}

/**
 * The character set named by a header value or a meta tag, if it names one.
 * The label has to end at something — a quote, a bracket, or the end of the
 * header — so that a label the bytes cut in half is not read as a whole one.
 */
export function charsetOf(source: string | null | undefined): string | null {
  return (
    /charset\s*=\s*["']?([\w:.+-]+)(?:["'>;/\s]|$)/i.exec(source ?? "")?.[1] ??
    null
  )
}

/**
 * The character set a page declares for itself, or null when it declares none
 * we can read. Only a complete <meta> tag in the head counts — a feed whose
 * text happens to contain "charset=" does not get to choose the encoding.
 */
function declaredCharset(bytes: Uint8Array): string | null {
  const prefix = new TextDecoder("latin1").decode(
    bytes.subarray(0, SNIFF_BYTES)
  )
  const head = prefix.split("</head>")[0]
  for (const tag of head.match(/<meta[^>]*>/gi) ?? []) {
    const label = charsetOf(tag)
    if (label) return label
  }
  return null
}

function decoderFor(label: string | null | undefined): TextDecoder | null {
  if (!label) return null
  try {
    return new TextDecoder(label)
  } catch {
    // A label no decoder knows: a typo, a private encoding name, or a label
    // the response was cut off partway through.
    return null
  }
}

/**
 * Turn a response body into text, in the first encoding that works of: the one
 * the transport reports, the one the page declares, the caller's default, UTF-8.
 */
function decodePage(
  bytes: Uint8Array,
  reported: string | null,
  fallback: string
): { html: string; charset: string } {
  for (const label of [reported, declaredCharset(bytes), fallback]) {
    if (!label) continue
    const decoder = decoderFor(label)
    if (decoder) return { html: decoder.decode(bytes), charset: label }
  }
  // Every label offered was one no decoder knows.
  return {
    html: new TextDecoder(DEFAULT_CHARSET).decode(bytes),
    charset: DEFAULT_CHARSET,
  }
}

/** Fetch a page directly, as a browser would. */
export const directTransport: PageTransport = async ({ url }) => {
  try {
    const res = await fetch(url, {
      headers: BROWSER_HEADERS,
      signal: AbortSignal.timeout(DIRECT_TIMEOUT_MS),
    })
    if (!res.ok) {
      log.warn("direct fetch refused", { url, status: res.status })
      return { ok: false, status: failureForStatus(res.status) }
    }
    return {
      ok: true,
      bytes: new Uint8Array(await res.arrayBuffer()),
      charset: charsetOf(res.headers.get("content-type")),
      via: "direct",
    }
  } catch (err) {
    log.warn("direct fetch failed", { url, error: errorMessage(err) })
    return { ok: false, status: "unreachable" }
  }
}

/**
 * Fetch a page through Firecrawl. Several sources (Letterboxd, sometimes
 * Rotten Tomatoes, Blu-ray.com under load) refuse datacenter IPs outright, so
 * a direct fetch that works from a home connection 403s from most hosting.
 */
export const firecrawlTransport: PageTransport = async ({ url }) => {
  if (!env.FIRECRAWL_API_KEY) {
    log.warn("no FIRECRAWL_API_KEY — giving up on blocked page", { url })
    return { ok: false, status: "blocked" }
  }
  try {
    const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.FIRECRAWL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url, formats: ["rawHtml"] }),
      signal: AbortSignal.timeout(FIRECRAWL_TIMEOUT_MS),
    })
    const payload = (await res.json()) as {
      data?: { rawHtml?: string; metadata?: { statusCode?: number } }
    }
    if (payload.data?.metadata?.statusCode === 404) {
      return { ok: false, status: "notfound" }
    }
    if (!res.ok || !payload.data?.rawHtml) {
      log.warn("Firecrawl scrape failed", { url, status: res.status })
      return { ok: false, status: "blocked" }
    }
    // Firecrawl hands back text it has already decoded. Re-encoding it keeps
    // every transport on one contract — bytes, plus the label that describes
    // them — and reporting UTF-8 stops the page's own (now stale) label being
    // applied to text that has already been converted once.
    return {
      ok: true,
      bytes: new TextEncoder().encode(payload.data.rawHtml),
      charset: "utf-8",
      via: "firecrawl",
    }
  } catch (err) {
    log.error("Firecrawl unreachable", { url, error: errorMessage(err) })
    return { ok: false, status: "unreachable" }
  }
}

/**
 * Try `primary`, and on a refusal try `fallback`. A page the source says is
 * not there stops here: another route will not find it either.
 */
export function withFallback(
  primary: PageTransport,
  fallback: PageTransport
): PageTransport {
  return async (request) => {
    if (!request.preferFallback) {
      const first = await primary(request)
      if (first.ok || first.status === "notfound") return first
      log.warn("trying the fallback transport", {
        url: request.url,
        status: first.status,
      })
    }
    return fallback(request)
  }
}

/** What production fetches with: direct, then Firecrawl when refused. */
export const defaultTransport = withFallback(
  directTransport,
  firecrawlTransport
)

/** Fetch one page and read it as text. */
export async function fetchPage(
  request: PageRequest,
  transport: PageTransport = defaultTransport
): Promise<PageResult> {
  const result = await transport(request)
  if (!result.ok) return result

  const { html, charset } = decodePage(
    result.bytes,
    result.charset,
    request.defaultCharset ?? DEFAULT_CHARSET
  )
  return { ok: true, html, charset, via: result.via }
}
