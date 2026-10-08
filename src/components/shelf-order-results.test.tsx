// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ShelfOrderResults } from "@/components/shelf-order-results"
import type { Film, Shelf } from "@/db/schema"
import { checkShelfOrder } from "@/lib/shelf-order"
import type { ShelfSpine } from "@/lib/shelf-reading"
import { filmFixture } from "@/test/film-fixture"

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Link: (await import("@/test/link-stub")).LinkStub,
}))

afterEach(cleanup)

const shelf: Shelf = {
  id: "dvd",
  name: "DVD",
  rules: [{ field: "format", values: ["DVD"] }],
}
const dvd = (title: string) => filmFixture({ title, year: null, format: "DVD" })
const [alien, brazil, cure, dune, eraserhead] = [
  "Alien",
  "Brazil",
  "Cure",
  "Dune",
  "Eraserhead",
].map(dvd)
const films = [alien, brazil, cure, dune, eraserhead]

const read = (film: Film | string): ShelfSpine => ({
  text: typeof film === "string" ? film.toUpperCase() : film.title,
  title: typeof film === "string" ? film : film.title,
  year: null,
  format: "DVD",
  label: null,
  spineNumber: null,
  legibility: "clear",
  status: typeof film === "string" ? "missing" : "owned",
  film:
    typeof film === "string"
      ? null
      : {
          id: film.id,
          title: film.title,
          year: null,
          format: "DVD",
          coverUrl: null,
        },
})

describe("ShelfOrderResults", () => {
  it("lists each move in words, with the titles emphasised", () => {
    // Dune sits between Alien and Brazil; Cure is missing from the photo.
    const check = checkShelfOrder(
      [alien, dune, brazil, eraserhead, "Stalker"].map(read),
      shelf,
      films,
      [shelf]
    )
    render(
      <ShelfOrderResults check={check} films={films} orientation="upright" />
    )

    expect(screen.getByText("1 to move")).toBeDefined()
    expect(
      screen.getByText(/5 discs photographed, read left to right/)
    ).toBeDefined()

    const move = within(
      screen.getByRole("region", { name: /Moves/ })
    ).getByRole("listitem")
    expect(move.textContent).toBe("Move Dune between Brazil and Eraserhead")
    expect(
      Array.from(move.querySelectorAll("em")).map((em) => em.textContent)
    ).toEqual(["Dune", "Brazil", "Eraserhead"])

    // Adding an uncatalogued disc comes back to this shelf's order check.
    const add = screen.getByRole("button", { name: "Add Stalker" })
    expect(
      new URL(add.getAttribute("href")!, "http://spine.test").searchParams.get(
        "checkShelf"
      )
    ).toBe("dvd")

    expect(
      within(
        screen.getByRole("region", {
          name: /Expected here but not in the photo/,
        })
      ).getByRole("link", { name: "Cure" })
    ).toBeDefined()
    expect(screen.queryByRole("button", { name: "Mark arranged" })).toBeNull()
  })

  it("says to move a disc to the start on an upright shelf", () => {
    const check = checkShelfOrder(
      [brazil, cure, alien].map(read),
      shelf,
      films,
      [shelf]
    )
    render(
      <ShelfOrderResults check={check} films={films} orientation="upright" />
    )
    expect(
      within(screen.getByRole("region", { name: /Moves/ })).getByRole(
        "listitem"
      ).textContent
    ).toBe("Move Alien to the start, before Brazil")
  })

  it("offers Mark arranged when everything is in order", () => {
    const check = checkShelfOrder(
      [alien, brazil, cure].map(read),
      shelf,
      films,
      [shelf]
    )
    const onMark = vi.fn()
    render(
      <ShelfOrderResults
        check={check}
        films={films}
        orientation="upright"
        markArranged={{ pending: false, done: false, onMark }}
      />
    )
    expect(screen.getByText("All 3 in order")).toBeDefined()
    screen.getByRole("button", { name: "Mark arranged" }).click()
    expect(onMark).toHaveBeenCalledOnce()
    expect(screen.queryByRole("region", { name: /Moves/ })).toBeNull()
  })
})
