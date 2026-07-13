import { QueryClient } from "@tanstack/react-query"
import { describe, expect, it, vi } from "vitest"
import { endSession } from "@/lib/end-session"

describe("endSession", () => {
  it("clears data cached for the previous account before leaving the app", async () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(["films"], [{ id: "private-film" }])
    queryClient.setQueryData(["settings"], { owner: "previous-user" })

    const signOut = vi.fn().mockResolvedValue(undefined)
    const invalidateRouter = vi.fn().mockResolvedValue(undefined)
    const navigateToLogin = vi.fn().mockResolvedValue(undefined)

    await endSession({
      queryClient,
      signOut,
      invalidateRouter,
      navigateToLogin,
    })

    expect(signOut).toHaveBeenCalledOnce()
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0)
    expect(invalidateRouter).toHaveBeenCalledOnce()
    expect(navigateToLogin).toHaveBeenCalledOnce()
  })
})
