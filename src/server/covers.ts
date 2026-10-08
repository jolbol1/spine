import { createServerFn } from "@tanstack/react-start"
import { z } from "zod"
import { filmCovers, withUser } from "@/db"
import { coverPath, sniffImageType } from "@/lib/covers"
import { serverLogger } from "@/server/log"
import { authMiddleware } from "@/server/middleware"

const log = serverLogger("covers")

/** A flattened 1200px-tall JPEG is a few hundred KB; leave headroom. */
const MAX_COVER_BYTES = 4 * 1024 * 1024

/**
 * Store a front cover the user photographed and return the relative URL to
 * put in the film's cover field. The client has already flattened and
 * cropped it to the format's proportions.
 */
export const uploadCoverFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      image: z
        .string()
        .min(100)
        .max(Math.ceil((MAX_COVER_BYTES * 4) / 3) + 4),
    })
  )
  .handler(async ({ context, data }) => {
    const bytes = Buffer.from(data.image, "base64")
    const contentType = sniffImageType(bytes)
    if (!contentType) {
      return {
        ok: false as const,
        error: "That isn't a JPEG, PNG, or WebP image.",
      }
    }
    if (bytes.length > MAX_COVER_BYTES) {
      return { ok: false as const, error: "That cover image is too large." }
    }
    const [row] = await withUser(context.userId, (tx) =>
      tx
        .insert(filmCovers)
        .values({ userId: context.userId, contentType, data: bytes })
        .returning({ id: filmCovers.id })
    )
    log.info("stored cover", { id: row.id, bytes: bytes.length, contentType })
    return { ok: true as const, url: coverPath(row.id) }
  })
