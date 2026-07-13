// @vitest-environment jsdom

import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { CollectionSearch } from "@/components/collection-search"

describe("CollectionSearch", () => {
  it("reflects a new search value supplied by URL navigation", () => {
    const { rerender } = render(
      <CollectionSearch query="alien" onQueryChange={vi.fn()} />
    )

    rerender(<CollectionSearch query="dune" onQueryChange={vi.fn()} />)

    expect(screen.getByRole<HTMLInputElement>("textbox").value).toBe("dune")
  })
})
