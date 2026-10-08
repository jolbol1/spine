// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { BlurayImportBox } from "@/components/bluray-import"
import type { FilmFormValues } from "@/components/film-form"
import type { Film } from "@/db/schema"
import type { BlurayResult } from "@/server/bluray"
import { filmFixture } from "@/test/film-fixture"

// jsdom leaves scrollIntoView unimplemented.
beforeAll(() => {
  Element.prototype.scrollIntoView = () => {}
})

const server = vi.hoisted(() => ({
  searchBluray: vi.fn(),
  importBluray: vi.fn(),
  importCex: vi.fn(),
  searchWebBarcode: vi.fn(),
}))

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Link: (await import("@/test/link-stub")).LinkStub,
}))
vi.mock("@/server/bluray", () => ({
  searchBlurayFn: server.searchBluray,
  importBlurayUrlFn: server.importBluray,
}))
vi.mock("@/server/cex", () => ({ importCexFn: server.importCex }))
vi.mock("@/server/websearch", () => ({
  searchWebBarcodeFn: server.searchWebBarcode,
}))
vi.mock("@/server/wishlist", () => ({ scrapeWishlistUrlFn: vi.fn() }))

// Stand-in scanner: one button that reports a fixed detection.
vi.mock("@/components/barcode-scan", () => ({
  BarcodeScanDialog: ({
    open,
    onDetected,
  }: {
    open: boolean
    onDetected: (code: string) => void
  }) =>
    open ? (
      <button type="button" onClick={() => onDetected("5012345678900")}>
        simulate scan
      </button>
    ) : null,
}))

function renderImportBox(
  onImport: (values: FilmFormValues) => void,
  {
    autoOpenScanner = true,
    collection,
  }: { autoOpenScanner?: boolean; collection?: Array<Film> } = {}
) {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <BlurayImportBox
        onImport={onImport}
        autoOpenScanner={autoOpenScanner}
        collection={collection}
      />
    </QueryClientProvider>
  )
}

const blurayResult = (over: Partial<BlurayResult>): BlurayResult => ({
  title: "Some Film",
  year: 2001,
  url: "https://www.blu-ray.com/movies/some-film/1/",
  coverUrl: "https://images.example/1_front.jpg",
  countryFlag: null,
  releaseDate: null,
  ...over,
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("BlurayImportBox scanned-barcode chain", () => {
  it("fills the scanned barcode into a CEX import, like the Blu-ray.com path", async () => {
    server.searchBluray.mockResolvedValue([])
    // The CEX payload does not carry the code that was scanned — the
    // client knows it and must merge it in itself, as the Blu-ray.com
    // import path does.
    server.importCex.mockResolvedValue({
      success: true,
      data: {
        title: "Archive Film",
        year: 1999,
        format: "DVD",
        runtimeMinutes: 90,
        label: null,
        bbfcRating: null,
        genres: [],
        publisher: null,
        supplier: null,
        coverUrl: null,
        barcode: "",
      },
    })
    const onImport = vi.fn()
    renderImportBox(onImport)

    screen.getByRole("button", { name: "simulate scan" }).click()

    await waitFor(() => expect(onImport).toHaveBeenCalledOnce())
    const values = onImport.mock.calls[0][0] as FilmFormValues
    expect(values.title).toBe("Archive Film")
    expect(values.barcode).toBe("5012345678900")
  })
})

describe("BlurayImportBox scanning a disc already catalogued", () => {
  const owned = filmFixture({
    title: "Archive Film",
    year: 1999,
    format: "DVD",
    // The UPC-A form of the scanned EAN-13 — the same disc.
    barcode: "012345678900",
  })

  it("says so instead of looking it up, and looks it up on request", async () => {
    server.searchBluray.mockResolvedValue([])
    server.importCex.mockReturnValue(new Promise(() => {}))
    renderImportBox(vi.fn(), {
      collection: [owned, filmFixture({ title: "Other", barcode: null })],
    })

    // The stand-in scanner reports 5012345678900; make it match.
    owned.barcode = "5012345678900"
    screen.getByRole("button", { name: "simulate scan" }).click()

    const notice = await screen.findByRole("status")
    expect(notice.textContent).toContain(
      "Already in your collection: Archive Film (1999) · DVD"
    )
    // A link styled as a button, as Base UI renders it.
    expect(
      screen.getByRole("button", { name: "Open" }).getAttribute("href")
    ).toBe(`/films/${owned.id}`)
    expect(server.searchBluray).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole("button", { name: "Look it up anyway" }))
    await waitFor(() =>
      expect(server.searchBluray).toHaveBeenCalledWith(
        expect.objectContaining({ data: { query: "5012345678900" } })
      )
    )
    expect(screen.queryByText(/Already in your collection/)).toBeNull()
  })
})

describe("BlurayImportBox autocomplete", () => {
  it("exposes results as a listbox the arrow keys walk and Enter imports", async () => {
    server.searchBluray.mockResolvedValue([
      blurayResult({
        title: "First Film",
        url: "https://www.blu-ray.com/movies/1/",
      }),
      blurayResult({
        title: "Second Film",
        url: "https://www.blu-ray.com/movies/2/",
      }),
    ])
    server.importBluray.mockReturnValue(new Promise(() => {}))
    renderImportBox(vi.fn(), { autoOpenScanner: false })

    const input = screen.getByRole<HTMLInputElement>("combobox", {
      name: "Search Blu-ray.com or paste a product link",
    })
    fireEvent.change(input, { target: { value: "film" } })

    // The 400ms debounce elapses before the search fires.
    const listbox = await screen.findByRole("listbox", {}, { timeout: 3_000 })
    expect(input.getAttribute("aria-expanded")).toBe("true")
    expect(input.getAttribute("aria-controls")).toBe(listbox.id)

    const options = screen.getAllByRole("option")
    expect(options.map((o) => o.textContent)).toEqual([
      expect.stringContaining("First Film"),
      expect.stringContaining("Second Film"),
    ])

    fireEvent.keyDown(input, { key: "ArrowDown" })
    expect(options[0].getAttribute("aria-selected")).toBe("true")
    expect(input.getAttribute("aria-activedescendant")).toBe(options[0].id)

    fireEvent.keyDown(input, { key: "ArrowDown" })
    expect(options[1].getAttribute("aria-selected")).toBe("true")

    fireEvent.keyDown(input, { key: "Enter" })
    await waitFor(() =>
      expect(server.importBluray).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { url: "https://www.blu-ray.com/movies/2/" },
        })
      )
    )
  })

  it("closes the listbox on Escape and reopens it on ArrowDown", async () => {
    server.searchBluray.mockResolvedValue([
      blurayResult({
        title: "Only Film",
        url: "https://www.blu-ray.com/movies/1/",
      }),
    ])
    renderImportBox(vi.fn(), { autoOpenScanner: false })

    const input = screen.getByRole<HTMLInputElement>("combobox", {
      name: "Search Blu-ray.com or paste a product link",
    })
    fireEvent.change(input, { target: { value: "film" } })
    await screen.findByRole("listbox", {}, { timeout: 3_000 })

    fireEvent.keyDown(input, { key: "Escape" })
    expect(screen.queryByRole("listbox")).toBeNull()
    expect(input.getAttribute("aria-expanded")).toBe("false")

    fireEvent.keyDown(input, { key: "ArrowDown" })
    expect(screen.queryByRole("listbox")).not.toBeNull()
  })
})
