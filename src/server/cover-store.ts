import { and, count, eq, lt, sql } from "drizzle-orm"
import { filmCovers, films } from "@/db"
import { customCoverId } from "@/lib/covers"
import type { Tx } from "@/db"

/**
 * Server-only cover helpers, shared by the film and cover server functions.
 * (Server-function modules export only server functions, so their database
 * imports never reach the client bundle.)
 */

/**
 * Delete a photographed cover once no film of the user's points at it —
 * after a film's cover is replaced or the film is deleted.
 */
export async function releaseCustomCover(
  tx: Tx,
  url: string | null | undefined
): Promise<void> {
  const id = customCoverId(url)
  if (!id || !url) return
  const [{ uses }] = await tx
    .select({ uses: count() })
    .from(films)
    .where(eq(films.coverUrl, url))
  if (uses > 0) return
  await tx.delete(filmCovers).where(eq(filmCovers.id, id))
}

/** How long an uploaded cover may sit unused before it's swept. */
const ORPHAN_GRACE = "1 day"

/**
 * Delete the user's photographed covers that no film points at and that
 * are older than a day — uploads from a form that was then abandoned. Runs
 * on each upload, so it needs no scheduler; the grace period keeps a cover
 * whose form is still open.
 */
export async function sweepOrphanCovers(tx: Tx): Promise<void> {
  await tx
    .delete(filmCovers)
    .where(
      and(
        lt(filmCovers.createdAt, sql`now() - ${ORPHAN_GRACE}::interval`),
        sql`not exists (select 1 from ${films} where ${films.coverUrl} = '/api/covers/' || ${filmCovers.id}::text)`
      )
    )
}
