import { count, eq } from "drizzle-orm"
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
