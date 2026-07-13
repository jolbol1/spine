import type { QueryClient } from "@tanstack/react-query"

interface EndSessionOptions {
  queryClient: QueryClient
  signOut: () => Promise<unknown>
  invalidateRouter: () => Promise<unknown>
  navigateToLogin: () => Promise<unknown>
}

export async function endSession({
  queryClient,
  signOut,
  invalidateRouter,
  navigateToLogin,
}: EndSessionOptions) {
  await signOut()
  queryClient.clear()
  await invalidateRouter()
  await navigateToLogin()
}
