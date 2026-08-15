// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { BlurayImportBox } from "@/components/bluray-import"
import type { FilmFormValues } from "@/components/film-form"

const server = vi.hoisted(() => ({
  searchBluray: vi.fn(),
  importCex: vi.fn(),
  searchWebBarcode: vi.fn(),
}))

vi.mock("@/server/bluray", () => ({
  searchBlurayFn: server.searchBluray,
  importBlurayUrlFn: vi.fn(),
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

function renderImportBox(onImport: (values: FilmFormValues) => void) {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <BlurayImportBox onImport={onImport} autoOpenScanner />
    </QueryClientProvider>
  )
}

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
