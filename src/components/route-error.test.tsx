// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { RouteErrorScreen } from "@/components/route-error"

afterEach(cleanup)

describe("RouteErrorScreen", () => {
  it("catches a failed load and recovers when Try again re-runs it", async () => {
    let attempts = 0
    const rootRoute = createRootRoute()
    const indexRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: "/",
      loader: () => {
        attempts += 1
        if (attempts === 1) throw new Error("database is down")
      },
      component: () => <p>collection loaded</p>,
    })
    const router = createRouter({
      routeTree: rootRoute.addChildren([indexRoute]),
      history: createMemoryHistory(),
      defaultErrorComponent: RouteErrorScreen,
    })
    const queryClient = new QueryClient()

    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router as never} />
      </QueryClientProvider>
    )

    // The failed load shows our screen — message, cause, and a retry.
    await screen.findByText("Something went wrong")
    expect(screen.getByText("database is down")).toBeDefined()

    fireEvent.click(screen.getByRole("button", { name: /try again/i }))
    await screen.findByText("collection loaded")
    expect(attempts).toBe(2)
  })
})
