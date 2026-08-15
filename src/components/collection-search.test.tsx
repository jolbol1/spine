// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { CollectionSearch } from "@/components/collection-search"

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe("CollectionSearch", () => {
  it("reflects a new search value supplied by URL navigation", () => {
    const { rerender } = render(
      <CollectionSearch query="alien" onQueryChange={vi.fn()} />
    )

    rerender(<CollectionSearch query="dune" onQueryChange={vi.fn()} />)

    expect(screen.getByRole<HTMLInputElement>("textbox").value).toBe("dune")
  })

  it("keeps a trailing space when the page echoes the trimmed query back", () => {
    vi.useFakeTimers()
    const onQueryChange = vi.fn()
    const { rerender } = render(
      <CollectionSearch query="" onQueryChange={onQueryChange} />
    )

    const input = screen.getByRole<HTMLInputElement>("textbox")
    fireEvent.change(input, { target: { value: "dune " } })
    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(onQueryChange).toHaveBeenCalledWith("dune")

    // The page writes the trimmed query into the URL and echoes it back.
    rerender(<CollectionSearch query="dune" onQueryChange={onQueryChange} />)

    expect(input.value).toBe("dune ")
  })

  it("does not cancel typing done while the previous search was echoing", () => {
    vi.useFakeTimers()
    const onQueryChange = vi.fn()
    const { rerender } = render(
      <CollectionSearch query="" onQueryChange={onQueryChange} />
    )

    const input = screen.getByRole<HTMLInputElement>("textbox")
    fireEvent.change(input, { target: { value: "dune" } })
    act(() => {
      vi.advanceTimersByTime(300)
    })
    // More typing before the echo lands.
    fireEvent.change(input, { target: { value: "dune s" } })
    rerender(<CollectionSearch query="dune" onQueryChange={onQueryChange} />)

    expect(input.value).toBe("dune s")
    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(onQueryChange).toHaveBeenLastCalledWith("dune s")
  })
})
