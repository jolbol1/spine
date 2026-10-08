import { createServerFn } from "@tanstack/react-start"
import { asc } from "drizzle-orm"
import { z } from "zod"
import { films, withUser } from "@/db"
import { env } from "@/env"
import { resolveShelfSpines } from "@/lib/shelf-reading"
import { errorMessage, serverLogger } from "@/server/log"
import { authMiddleware } from "@/server/middleware"
import { ShelfReadError, readShelfPhoto } from "@/server/shelf-reader"

const log = serverLogger("shelf-scan")

/**
 * Base64 of one photo. Clients scale to 2576px on the long edge (the
 * model's full resolution) and JPEG-compress to well under this.
 */
const MAX_IMAGE_BASE64 = 8 * 1024 * 1024

/**
 * Read the disc spines in a shelf photo and say which are already in the
 * collection, which are catalogued in another format, and which are
 * missing. One photo per call; clients merge several.
 */
export const scanShelfPhotoFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      image: z.string().min(100).max(MAX_IMAGE_BASE64),
      mediaType: z.enum(["image/jpeg", "image/png", "image/webp"]),
    })
  )
  .handler(async ({ context, data }) => {
    if (!env.ANTHROPIC_API_KEY) {
      return {
        ok: false as const,
        error:
          "Reading shelf photos needs ANTHROPIC_API_KEY in the server's .env.",
      }
    }

    const collection = await withUser(context.userId, (tx) =>
      tx
        .select({
          id: films.id,
          title: films.title,
          year: films.year,
          format: films.format,
          label: films.label,
          spineNumber: films.spineNumber,
          coverUrl: films.coverUrl,
        })
        .from(films)
        .orderBy(asc(films.sortTitle), asc(films.year))
    )

    try {
      const reading = await readShelfPhoto(
        data.image,
        data.mediaType,
        collection
      )
      const spines = resolveShelfSpines(reading, collection)
      log.info("read shelf photo", {
        spines: spines.length,
        missing: spines.filter((s) => s.status === "missing").length,
      })
      return { ok: true as const, spines }
    } catch (err) {
      if (err instanceof ShelfReadError) {
        log.warn("shelf photo not read", { error: err.message })
        return { ok: false as const, error: err.message }
      }
      log.error("shelf photo failed", { error: errorMessage(err) })
      return { ok: false as const, error: "Reading the shelf photo failed." }
    }
  })
