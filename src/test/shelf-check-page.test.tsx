// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import type { ComponentType } from "react"
import { Suspense } from "react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { serializeShelfCheck } from "@/lib/shelf-check"
import type { ShelfSpine } from "@/lib/shelf-reading"
import { Route } from "@/routes/_app/shelf-check"
import { filmFixture } from "@/test/film-fixture"

const server = vi.hoisted(() => ({
  listFilms: vi.fn(),
  getSettings: vi.fn(),
  saveShelves: vi.fn(),
  navigate: vi.fn(),
}))

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Link: (await import("@/test/link-stub")).LinkStub,
  useNavigate: () => server.navigate,
}))
vi.mock("@/server/films", () => ({
  listFilmsFn: server.listFilms,
  getFilmFn: vi.fn(),
}))
vi.mock("@/server/settings", () => ({
  getSettingsFn: server.getSettings,
  saveShelvesFn: server.saveShelves,
}))
vi.mock("@/server/wishlist", () => ({ listWishlistFn: vi.fn() }))
vi.mock("@/server/shelf-scan", () => ({ scanShelfPhotoFn: vi.fn() }))

// The router plugin code-splits route components into a lazy wrapper;
// preload the split module so the page can render outside the router.
const ShelfCheckPage = Route.options.component as ComponentType & {
  preload?: () => Promise<void>
}
beforeAll(() => ShelfCheckPage.preload?.())

/** The page's search params, as the router would give them. */
const search = (params: { shelf?: string }) =>
  vi.spyOn(Route, "useSearch").mockReturnValue(params)

function renderPage() {
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <Suspense fallback="loading">
        <ShelfCheckPage />
      </Suspense>
    </QueryClientProvider>
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const spine = (over: Partial<ShelfSpine> & Pick<ShelfSpine, "title">) =>
  ({
    text: over.title.toUpperCase(),
    year: null,
    format: null,
    label: null,
    spineNumber: null,
    legibility: "clear",
    status: "missing",
    film: null,
    ...over,
  }) satisfies ShelfSpine

const dune = filmFixture({ title: "Dune", year: 2021, format: "4K UHD" })
const heat = filmFixture({ title: "Heat", year: 1995, format: "Blu-ray" })
/** Added to the collection since the photo was read. */
const brazil = filmFixture({ title: "Brazil", year: 1985, format: "Blu-ray" })

const asSpineFilm = (film: typeof dune) => ({
  id: film.id,
  title: film.title,
  year: film.year,
  format: film.format,
  coverUrl: film.coverUrl,
})

describe("ShelfCheckPage", () => {
  it("restores the last check and sorts it against the collection now", async () => {
    sessionStorage.setItem(
      "spine.shelf-check",
      serializeShelfCheck([
        {
          id: "p1",
          name: "left.jpg",
          thumbnail: null,
          result: {
            ok: true,
            spines: [
              spine({
                title: "Paris, Texas",
                text: "PARIS, TEXAS · CRITERION 501",
                year: 1984,
                format: "Blu-ray",
                label: "Criterion",
                spineNumber: 501,
                legibility: "partial",
              }),
              spine({ title: "Brazil", year: 1985, format: "Blu-ray" }),
              spine({
                title: "Dune",
                year: 2021,
                format: "Blu-ray",
                status: "other-format",
                film: asSpineFilm(dune),
              }),
              spine({
                title: "Heat",
                year: 1995,
                format: "Blu-ray",
                status: "owned",
                film: asSpineFilm(heat),
              }),
            ],
          },
        },
        {
          id: "p2",
          name: "right.jpg",
          thumbnail: null,
          result: {
            ok: false,
            error:
              "Reading shelf photos needs ANTHROPIC_API_KEY in the server's .env.",
          },
        },
      ])
    )
    server.listFilms.mockResolvedValue([dune, heat, brazil])
    server.getSettings.mockResolvedValue({
      shelves: [
        {
          id: "uhd",
          name: "4K",
          rules: [{ field: "format", values: ["4K UHD"] }],
        },
        {
          id: "bd",
          name: "Blu-ray",
          rules: [{ field: "format", values: ["Blu-ray"] }],
        },
      ],
    })
    search({})
    renderPage()

    // A failed photo keeps the server's own words.
    expect(
      await screen.findByText(
        "Reading shelf photos needs ANTHROPIC_API_KEY in the server's .env."
      )
    ).toBeDefined()
    expect(screen.getByRole("status").textContent).toBe(
      "Read 1 of 2 photos · 1 couldn't be read"
    )

    const missing = within(
      screen.getByRole("region", { name: /Not in your collection/ })
    )
    expect(missing.getByText("“PARIS, TEXAS · CRITERION 501”")).toBeDefined()
    expect(missing.getByText("Criterion")).toBeDefined()
    expect(missing.getByText("Spine #501")).toBeDefined()
    expect(missing.getByText(/Hard to read/)).toBeDefined()
    const add = new URL(
      missing
        .getByRole("button", { name: "Add Paris, Texas" })
        .getAttribute("href")!,
      "http://spine.test"
    )
    expect(add.pathname).toBe("/add")
    expect(Object.fromEntries(add.searchParams)).toEqual({
      title: "Paris, Texas",
      year: "1984",
      format: "Blu-ray",
      importQuery: "Paris, Texas",
      from: "shelf-check",
    })
    // Brazil was missing when read, but it's been added since.
    expect(
      missing
        .getByRole("link", { name: /Added Brazil \(1985\)/ })
        .getAttribute("href")
    ).toBe(`/films/${brazil.id}`)

    const otherFormat = within(
      screen.getByRole("region", { name: /In another format/ })
    )
    expect(otherFormat.getByText(/You have it on/).textContent).toBe(
      "You have it on 4K UHD"
    )
    expect(
      otherFormat.getByRole("link", { name: "4K UHD" }).getAttribute("href")
    ).toBe(`/films/${dune.id}`)

    // Heat lives on the Blu-ray shelf, so the photo looks like that one.
    expect(
      screen.getByText("Looks like your Blu-ray shelf — check its order?")
    ).toBeDefined()
    expect(screen.getByRole("button", { name: "Check order" })).toBeDefined()

    // Already catalogued starts folded away.
    const toggle = screen.getByRole("button", { name: /Already catalogued/ })
    expect(toggle.getAttribute("aria-expanded")).toBe("false")
    expect(screen.queryByRole("link", { name: /Heat \(1995\)/ })).toBeNull()
    fireEvent.click(toggle)
    expect(toggle.getAttribute("aria-expanded")).toBe("true")
    expect(
      screen.getByRole("link", { name: /Heat \(1995\)/ }).getAttribute("href")
    ).toBe(`/films/${heat.id}`)
  })

  it("checks a stacked shelf's order and says what to move, top to bottom", async () => {
    const dvd = (title: string) =>
      filmFixture({ title, year: null, format: "DVD" })
    const [alien, cure, eraserhead, fargo] = [
      "Alien",
      "Cure",
      "Eraserhead",
      "Fargo",
    ].map(dvd)
    const pile = {
      id: "dvd",
      name: "DVD pile",
      rules: [{ field: "format" as const, values: ["DVD"] }],
      orientation: "stacked" as const,
    }
    const read = (film: typeof alien) =>
      spine({
        title: film.title,
        format: "DVD",
        status: "owned",
        film: asSpineFilm(film),
      })
    sessionStorage.setItem(
      "spine.shelf-check:shelf:dvd",
      serializeShelfCheck([
        {
          id: "p1",
          name: "top.jpg",
          thumbnail: null,
          // Fargo sits on top, where Alien should be.
          result: { ok: true, spines: [read(fargo), read(alien), read(cure)] },
        },
        {
          id: "p2",
          name: "bottom.jpg",
          thumbnail: null,
          result: {
            ok: true,
            spines: [read(cure), read(eraserhead), read(heat)],
          },
        },
      ])
    )
    server.listFilms.mockResolvedValue([alien, cure, eraserhead, fargo, heat])
    server.getSettings.mockResolvedValue({
      shelves: [
        pile,
        {
          id: "bd",
          name: "Blu-ray",
          rules: [{ field: "format", values: ["Blu-ray"] }],
        },
      ],
    })
    search({ shelf: "dvd" })
    renderPage()

    expect(await screen.findByText("1 to move")).toBeDefined()
    expect(screen.getByText(/stacked flat, read top to bottom/)).toBeDefined()
    const moves = within(screen.getByRole("region", { name: /Moves/ }))
    expect(moves.getByRole("listitem").textContent).toBe(
      "Move Fargo to the bottom, below Eraserhead"
    )
    const elsewhere = within(
      screen.getByRole("region", { name: /Belongs on another shelf/ })
    )
    expect(elsewhere.getByRole("listitem").textContent).toBe("Heat → Blu-ray")
    // The strip shows each disc once, in the order photographed.
    expect(
      within(screen.getByRole("region", { name: "The discs as photographed" }))
        .getAllByRole("listitem")
        .map((item) => item.textContent)
    ).toEqual([
      "Fargo — Move",
      "Alien — In place",
      "Cure — In place",
      "Eraserhead — In place",
      "Heat — Other shelf",
    ])
    // Not in order yet, so no shortcut to mark it arranged.
    expect(screen.queryByRole("button", { name: "Mark arranged" })).toBeNull()
  })

  it("offers to mark a shelf arranged once it's all in order", async () => {
    const dvd = (title: string) =>
      filmFixture({ title, year: null, format: "DVD" })
    const [first, second] = ["Alien", "Brazil"].map(dvd)
    // A shelf of its own: the store outlives a test.
    const shelf = {
      id: "dvd-in-order",
      name: "DVD",
      rules: [{ field: "format" as const, values: ["DVD"] }],
    }
    sessionStorage.setItem(
      "spine.shelf-check:shelf:dvd-in-order",
      serializeShelfCheck([
        {
          id: "p1",
          name: "shelf.jpg",
          thumbnail: null,
          result: {
            ok: true,
            spines: [first, second].map((film) =>
              spine({
                title: film.title,
                status: "owned",
                film: asSpineFilm(film),
              })
            ),
          },
        },
      ])
    )
    server.listFilms.mockResolvedValue([first, second])
    server.getSettings.mockResolvedValue({ shelves: [shelf] })
    server.saveShelves.mockResolvedValue({ ok: true })
    search({ shelf: "dvd-in-order" })
    renderPage()

    expect(await screen.findByText("All 2 in order")).toBeDefined()
    fireEvent.click(screen.getByRole("button", { name: "Mark arranged" }))
    await waitFor(() => expect(server.saveShelves).toHaveBeenCalledOnce())
    const saved = server.saveShelves.mock.calls[0][0].data.shelves
    expect(saved).toEqual([
      { ...shelf, arrangedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) },
    ])
    expect(await screen.findByText("Marked arranged")).toBeDefined()
  })
})
