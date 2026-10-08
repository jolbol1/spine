// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { FilmForm, emptyFilmValues } from "@/components/film-form"

vi.mock("@/server/bluray", () => ({ searchBlurayFn: vi.fn() }))
vi.mock("@/server/criterion", () => ({ lookupSpineFn: vi.fn() }))

afterEach(cleanup)

describe("FilmForm control names", () => {
  it("associates every select with its visible label", () => {
    const queryClient = new QueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <FilmForm
          initial={emptyFilmValues}
          submitLabel="Add"
          pending={false}
          onSubmit={vi.fn()}
        />
      </QueryClientProvider>
    )

    // Each select trigger must announce the label it sits beside.
    for (const name of ["Format", "HDR", "Region", "Package type"]) {
      const trigger = screen.getByLabelText(name)
      expect(trigger.tagName).toBe("BUTTON")
    }
  })
})
