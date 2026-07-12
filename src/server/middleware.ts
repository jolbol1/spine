import { createMiddleware } from "@tanstack/react-start"
import { getRequest } from "@tanstack/react-start/server"
import { auth } from "@/lib/auth"

/**
 * Requires an authenticated session; exposes `userId` to server functions.
 * Combined with `withUser()` every DB access is scoped by Postgres RLS.
 */
export const authMiddleware = createMiddleware({ type: "function" }).server(
  async ({ next }) => {
    const request = getRequest()
    const session = await auth.api.getSession({ headers: request.headers })
    if (!session) {
      throw new Response("Unauthorized", { status: 401 })
    }
    return next({
      context: {
        userId: session.user.id,
        userName: session.user.name,
      },
    })
  }
)
