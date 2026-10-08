// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { FilmForm, emptyFilmValues } from "@/components/film-form"
import type { FilmFormValues } from "@/components/film-form"
import type { Film } from "@/db/schema"
import { filmFixture } from "@/test/film-fixture"

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Link: (await import("@/test/link-stub")).LinkStub,
}))
vi.mock("@/server/bluray", () => ({ searchBlurayFn: vi.fn() }))
vi.mock("@/server/criterion", () => ({ lookupSpineFn: vi.fn() }))
vi.mock("@/server/covers", () => ({ uploadCoverFn: vi.fn() }))

afterEach(cleanup)

const dune = filmFixture({
  title: "Dune",
  year: 2021,
  format: "4K UHD",
  barcode: "5051892234953",
})

function renderForm({
  initial = emptyFilmValues,
  collection = [dune],
  excludeId,
}: {
  initial?: FilmFormValues
  collection?: Array<Film>
  excludeId?: string
} = {}) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <FilmForm
        initial={initial}
        submitLabel="Add to collection"
        sameDiscSubmitLabel="Add another copy"
        collection={collection}
        excludeId={excludeId}
        pending={false}
        onSubmit={vi.fn()}
      />
    </QueryClientProvider>
  )
}

const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } })

describe("FilmForm duplicate warning", () => {
  it("says nothing until the title matches something catalogued", () => {
    renderForm()
    type("Title *", "Dun")
    expect(screen.queryByText(/already|another copy/i)).toBeNull()
    expect(
      screen.getByRole("button", { name: "Add to collection" })
    ).toBeDefined()
  })

  it("calls a match in another format another copy, and still adds", () => {
    renderForm()
    type("Title *", "dune")
    type("Year", "2021")

    expect(
      screen.getByText("You have it on 4K UHD — this would be another copy.")
    ).toBeDefined()
    expect(screen.getByText("Dune (2021) · 4K UHD")).toBeDefined()
    expect(
      screen.getByRole("link", { name: /Open Dune \(2021\) in a new tab/ })
    ).toHaveProperty("target", "_blank")
    expect(
      screen.getByRole("button", { name: "Add to collection" })
    ).toBeDefined()
  })

  it("offers to add another copy of the same disc", () => {
    renderForm({ initial: { ...emptyFilmValues, format: "4K UHD" } })
    type("Title *", "The Dune")
    expect(screen.getByText("Already in your collection.")).toBeDefined()
    expect(
      screen.getByRole("button", { name: "Add another copy" })
    ).toBeDefined()
  })

  it("knows a barcode match is the exact disc, whatever the title", () => {
    renderForm()
    type("Title *", "Dune: Part One")
    type("Barcode (UPC/EAN)", "5051892234953")
    expect(
      screen.getByText("Same barcode — this exact disc is already catalogued.")
    ).toBeDefined()
    expect(
      screen.getByRole("button", { name: "Add another copy" })
    ).toBeDefined()
  })

  it("leaves out the film being edited", () => {
    renderForm({
      initial: { ...emptyFilmValues, title: "Dune", year: "2021" },
      excludeId: dune.id,
    })
    expect(screen.queryByText(/another copy|already/i)).toBeNull()
  })
})
