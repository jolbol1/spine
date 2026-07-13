/**
 * Criterion spine list cache — server-only helpers.
 *
 * Deliberately separate from criterion.ts: modules imported by client code
 * must export only createServerFn wrappers, or their db imports leak into
 * the browser bundle. This module is imported exclusively from inside
 * server function handlers.
 */
import { eq, sql } from "drizzle-orm"
import { criterionSpines, db } from "@/db"
import { env } from "@/env"

const LIST_URL = "https://www.criterion.com/shop/browse/list?sort=spine_number"
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000 // a week

/** Loose title key: lowercase, no leading article, alphanumerics only. */
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/^(the|a|an)\s+/, "")
    .replace(/[^a-z0-9]/g, "")
}

interface SpineRow {
  spine: number
  title: string
  director: string | null
  year: number | null
}

/**
 * Parse the criterion.com list view (as Firecrawl markdown). Rows look like:
 * `| 2 | ![Seven Samurai](…) | Seven Samurai | Akira Kurosawa | Japan, | 1954 |`
 */
function parseList(markdown: string): SpineRow[] {
  const rows: SpineRow[] = []
  for (const line of markdown.split("\n")) {
    const m = line.match(
      /^\|\s*(\d+)\s*\|[^|]*\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|[^|]*\|\s*(\d{4})?\s*\|/
    )
    if (!m) continue
    const title = m[2].replace(/\\/g, "").trim()
    if (!title) continue
    rows.push({
      spine: Number(m[1]),
      title,
      director: m[3].trim() || null,
      year: m[4] ? Number(m[4]) : null,
    })
  }
  return rows
}

/**
 * Ensure the spine cache exists and is fresh. Criterion.com sits behind
 * Cloudflare, so the scrape goes through Firecrawl. Returns the row count,
 * or an error message when scraping isn't possible.
 */
export async function refreshCacheIfStale(): Promise<
  { ok: true; rows: number; refreshed: boolean } | { ok: false; error: string }
> {
  const newest = await db
    .select({ fetchedAt: criterionSpines.fetchedAt })
    .from(criterionSpines)
    .orderBy(sql`${criterionSpines.fetchedAt} desc`)
    .limit(1)
  const age = newest[0] ? Date.now() - newest[0].fetchedAt.getTime() : Infinity
  if (age < CACHE_MAX_AGE_MS) {
    const count = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(criterionSpines)
    return { ok: true, rows: count[0].n, refreshed: false }
  }

  if (!env.FIRECRAWL_API_KEY) {
    return {
      ok: false,
      error: "Set FIRECRAWL_API_KEY in .env to fetch the Criterion list.",
    }
  }

  let markdown: string
  try {
    const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.FIRECRAWL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: LIST_URL,
        formats: ["markdown"],
        onlyMainContent: true,
      }),
      signal: AbortSignal.timeout(120_000),
    })
    const payload = (await res.json()) as {
      data?: { markdown?: string }
      error?: string
    }
    if (!res.ok || !payload.data?.markdown) {
      return {
        ok: false,
        error: payload.error ?? "Could not scrape the Criterion list.",
      }
    }
    markdown = payload.data.markdown
  } catch {
    return { ok: false, error: "Scraping service unreachable." }
  }

  const rows = parseList(markdown)
  if (rows.length < 100) {
    // A layout change would tank the parse — keep the old cache in that case.
    return {
      ok: false,
      error: `Criterion list parse looks wrong (${rows.length} rows) — kept the existing cache.`,
    }
  }

  await db.transaction(async (tx) => {
    await tx.delete(criterionSpines)
    // Chunked inserts to stay under parameter limits.
    for (let i = 0; i < rows.length; i += 500) {
      await tx.insert(criterionSpines).values(
        rows.slice(i, i + 500).map((row) => ({
          spine: row.spine,
          title: row.title,
          normalizedTitle: normalizeTitle(row.title),
          director: row.director,
          year: row.year,
        }))
      )
    }
  })

  return { ok: true, rows: rows.length, refreshed: true }
}

/** Look up a spine number from the cache. Year disambiguates duplicates. */
export async function lookupSpine(
  title: string,
  year: number | null
): Promise<number | null> {
  const matches = await db
    .select()
    .from(criterionSpines)
    .where(eq(criterionSpines.normalizedTitle, normalizeTitle(title)))
    .limit(10)
  if (matches.length === 0) return null
  if (year != null) {
    const byYear = matches.find(
      (m) => m.year != null && Math.abs(m.year - year) <= 1
    )
    if (byYear) return byYear.spine
  }
  return matches[0].spine
}

/** True when the film's label reads like a Criterion release. */
export function isCriterionLabel(label: string | null): boolean {
  return label?.toLowerCase().includes("criterion") ?? false
}
