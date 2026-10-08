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
import type { Shelf } from "@/db/schema"
import { Route } from "@/routes/_app/shelves"

const server = vi.hoisted(() => ({
  listFilms: vi.fn(),
  getSettings: vi.fn(),
  saveShelves: vi.fn(),
  listWishlist: vi.fn(),
}))

vi.mock("@/server/films", () => ({
  listFilmsFn: server.listFilms,
  getFilmFn: vi.fn(),
}))
vi.mock("@/server/settings", () => ({
  getSettingsFn: server.getSettings,
  saveShelvesFn: server.saveShelves,
  saveViewsFn: vi.fn(),
}))
vi.mock("@/server/wishlist", () => ({
  listWishlistFn: server.listWishlist,
  createWishlistItemFn: vi.fn(),
  deleteWishlistItemFn: vi.fn(),
  moveToCollectionFn: vi.fn(),
  scrapeWishlistUrlFn: vi.fn(),
}))

// The router plugin code-splits route components into a lazy wrapper;
// preload the split module so the page can render outside the router.
const ShelvesPage = Route.options.component as ComponentType & {
  preload?: () => Promise<void>
}
beforeAll(() => ShelvesPage.preload?.())

const shelfFixture = (over: Partial<Shelf> & Pick<Shelf, "id" | "name">) => ({
  rules: [],
  ...over,
})

function renderShelves(shelves: Shelf[]) {
  server.listFilms.mockResolvedValue([])
  server.listWishlist.mockResolvedValue([])
  server.getSettings.mockResolvedValue({ shelves })
  server.saveShelves.mockResolvedValue({ ok: true })
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <Suspense fallback="loading">
        <ShelvesPage />
      </Suspense>
    </QueryClientProvider>
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const savedShelfIds = (call: number) =>
  (
    server.saveShelves.mock.calls[call][0] as { data: { shelves: Shelf[] } }
  ).data.shelves.map((s) => s.id)

describe("ShelvesPage reorder grip", () => {
  it("is focusable and the arrow keys move the shelf", async () => {
    renderShelves([
      shelfFixture({ id: "s1", name: "Alpha" }),
      shelfFixture({ id: "s2", name: "Beta" }),
    ])

    const grip = await screen.findByRole("button", { name: /Reorder Alpha/ })
    expect(grip.tabIndex).toBe(0)

    fireEvent.keyDown(grip, { key: "ArrowDown" })
    await waitFor(() => expect(server.saveShelves).toHaveBeenCalled())
    expect(savedShelfIds(0)).toEqual(["s2", "s1"])
  })

  it("does not move past the ends", async () => {
    renderShelves([
      shelfFixture({ id: "s1", name: "Alpha" }),
      shelfFixture({ id: "s2", name: "Beta" }),
    ])

    const grip = await screen.findByRole("button", { name: /Reorder Alpha/ })
    fireEvent.keyDown(grip, { key: "ArrowUp" })
    expect(server.saveShelves).not.toHaveBeenCalled()
  })
})

describe("ShelvesPage template confirm", () => {
  it("asks with the app's own dialog before replacing shelves", async () => {
    renderShelves([shelfFixture({ id: "s1", name: "Alpha" })])

    fireEvent.click(await screen.findByRole("button", { name: "Templates" }))
    fireEvent.click(await screen.findByRole("menuitem", { name: /By format/i }))

    // Nothing saved yet — the dialog gets the last word.
    expect(server.saveShelves).not.toHaveBeenCalled()
    const dialog = await screen.findByRole("dialog", {
      name: "Replace your shelves?",
    })
    expect(dialog).toBeDefined()

    fireEvent.click(screen.getByRole("button", { name: "Replace shelves" }))
    await waitFor(() => expect(server.saveShelves).toHaveBeenCalled())
  })
})
