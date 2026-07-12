import { createServerFn } from "@tanstack/react-start"
import { getRequest } from "@tanstack/react-start/server"
import { auth } from "@/lib/auth"

export const getSessionFn = createServerFn({ method: "GET" }).handler(
  async () => {
    const request = getRequest()
    const session = await auth.api.getSession({ headers: request.headers })
    if (!session) return null
    return {
      user: {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
      },
    }
  }
)
