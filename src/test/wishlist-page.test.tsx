// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import type { ComponentType } from "react"
import { Suspense } from "react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import type { WishlistItem } from "@/db/schema"
import { Route } from "@/routes/_app/wishlist"
import { wishlistItemFixture } from "@/test/film-fixture"

const server = vi.hoisted(() => ({
  listWishlist: vi.fn(),
  deleteWishlistItem: vi.fn(),
  moveToCollection: vi.fn(),
}))

vi.mock("@/server/wishlist", () => ({
  listWishlistFn: server.listWishlist,
  createWishlistItemFn: vi.fn(),
  deleteWishlistItemFn: server.deleteWishlistItem,
  moveToCollectionFn: server.moveToCollection,
  scrapeWishlistUrlFn: vi.fn(),
}))
vi.mock("@/server/films", () => ({ listFilmsFn: vi.fn(), getFilmFn: vi.fn() }))
vi.mock("@/server/settings", () => ({ getSettingsFn: vi.fn() }))

// The router plugin code-splits route components into a lazy wrapper;
// preload the split module so the page can render outside the router.
const WishlistPage = Route.options.component as ComponentType & {
  preload?: () => Promise<void>
}
beforeAll(() => WishlistPage.preload?.())

function renderWishlist(items: WishlistItem[]) {
  server.listWishlist.mockResolvedValue(items)
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <Suspense fallback="loading">
        <WishlistPage />
      </Suspense>
    </QueryClientProvider>
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("WishlistPage", () => {
  it("keeps other items interactive while one item's delete is pending", async () => {
    // The delete never resolves, so the mutation stays pending.
    server.deleteWishlistItem.mockReturnValue(new Promise(() => {}))
    renderWishlist([
      wishlistItemFixture({ title: "First Film" }),
      wishlistItemFixture({ title: "Second Film" }),
    ])

    const removeButtons = await screen.findAllByRole<HTMLButtonElement>(
      "button",
      { name: "Remove from wishlist" }
    )
    fireEvent.click(removeButtons[0])
    await waitFor(() => expect(removeButtons[0].disabled).toBe(true))

    expect(removeButtons[1].disabled).toBe(false)
    const ownButtons = screen.getAllByRole<HTMLButtonElement>("button", {
      name: /Own it/,
    })
    expect(ownButtons[1].disabled).toBe(false)
  })

  it("keeps other items interactive while one item's move is pending", async () => {
    server.moveToCollection.mockReturnValue(new Promise(() => {}))
    renderWishlist([
      wishlistItemFixture({ title: "First Film" }),
      wishlistItemFixture({ title: "Second Film" }),
    ])

    const ownButtons = await screen.findAllByRole<HTMLButtonElement>("button", {
      name: /Own it/,
    })
    fireEvent.click(ownButtons[0])
    await waitFor(() => expect(ownButtons[0].disabled).toBe(true))

    expect(ownButtons[1].disabled).toBe(false)
    const removeButtons = screen.getAllByRole<HTMLButtonElement>("button", {
      name: "Remove from wishlist",
    })
    expect(removeButtons[1].disabled).toBe(false)
  })
})
