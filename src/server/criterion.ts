import { createServerFn } from "@tanstack/react-start"
import { and, eq, isNull, like, sql } from "drizzle-orm"
import { z } from "zod"
import { films, withUser } from "@/db"
import { lookupSpine, refreshCacheIfStale } from "@/server/criterion-data"
import { authMiddleware } from "@/server/middleware"

/** One-off spine lookup for the add/edit form's auto-search button. */
export const lookupSpineFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      title: z.string().trim().min(1).max(500),
      year: z.number().int().nullable(),
    }),
  )
  .handler(async ({ data }) => {
    const cache = await refreshCacheIfStale()
    if (!cache.ok) return { ok: false as const, error: cache.error }
    const spine = await lookupSpine(data.title, data.year)
    return { ok: true as const, spine }
  })

/**
 * Backfill spine numbers for the user's Criterion-labelled films that
 * don't have one yet. Refreshes the criterion.com cache when stale.
 */
export const syncCriterionSpinesFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const cache = await refreshCacheIfStale()
    if (!cache.ok) return { ok: false as const, error: cache.error }

    const pending = await withUser(context.userId, (tx) =>
      tx
        .select({ id: films.id, title: films.title, year: films.year })
        .from(films)
        .where(
          and(
            isNull(films.spineNumber),
            like(sql`lower(${films.label})`, "%criterion%"),
          ),
        ),
    )

    let updated = 0
    for (const film of pending) {
      const spine = await lookupSpine(film.title, film.year)
      if (spine == null) continue
      await withUser(context.userId, (tx) =>
        tx
          .update(films)
          .set({ spineNumber: spine, updatedAt: new Date() })
          .where(eq(films.id, film.id)),
      )
      updated++
    }

    return {
      ok: true as const,
      listSize: cache.rows,
      refreshed: cache.refreshed,
      scanned: pending.length,
      updated,
    }
  })
