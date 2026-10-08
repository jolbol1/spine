import { createFileRoute } from "@tanstack/react-router"
import { eq } from "drizzle-orm"
import { db, filmCovers } from "@/db"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/**
 * Serves a photographed cover. The id is an unguessable UUID and the row
 * never changes, so it's public and cached forever; RLS lets any session
 * read covers by id but only the owner write them.
 */
export const Route = createFileRoute("/api/covers/$id")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        if (!UUID.test(params.id)) {
          return new Response("Not found", { status: 404 })
        }
        const cover = (
          await db
            .select({
              contentType: filmCovers.contentType,
              data: filmCovers.data,
            })
            .from(filmCovers)
            .where(eq(filmCovers.id, params.id))
            .limit(1)
        ).at(0)
        if (!cover) return new Response("Not found", { status: 404 })
        return new Response(new Uint8Array(cover.data), {
          headers: {
            "Content-Type": cover.contentType,
            "Cache-Control": "public, max-age=31536000, immutable",
            "X-Content-Type-Options": "nosniff",
          },
        })
      },
    },
  },
})
