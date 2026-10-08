import { expect, test } from "@playwright/test"
import { accountFor, addFilm, signUp, waitForHydration } from "./support"
import type { Page } from "@playwright/test"
import type { ShelfSpine } from "@/lib/shelf-reading"

/** Add films by title and return their ids, in the order given. */
async function addFilms(page: Page, titles: Array<string>) {
  const ids = new Map<string, string>()
  for (const title of titles) {
    await addFilm(page, { title })
    ids.set(title, page.url().split("/").pop()!)
  }
  return ids
}

/** A new catch-all shelf, built in the shelf builder. */
async function buildShelf(
  page: Page,
  name: string,
  sit: "Standing upright" | "Stacked flat"
) {
  await page.getByRole("link", { name: "Shelves", exact: true }).click()
  await page.getByRole("button", { name: "New custom shelf" }).click()
  const builder = page.getByRole("dialog", { name: "New shelf" })
  await builder.getByLabel("Name").fill(name)
  await builder.getByRole("button", { name: "Remove rule" }).click()
  await builder.getByText(sit).click()
  await expect(
    builder.getByRole("radio", { name: new RegExp(sit) })
  ).toBeChecked()
  await builder.getByRole("button", { name: "Add shelf" }).click()
  await expect(builder).toBeHidden()
  return page.getByRole("region", { name: `Shelf: ${name}` })
}

/** A spine the model read and matched to a catalogued Blu-ray. */
const owned = (title: string, id: string): ShelfSpine => ({
  text: title.toUpperCase(),
  title,
  year: null,
  format: "Blu-ray",
  label: null,
  spineNumber: null,
  legibility: "clear",
  status: "owned",
  film: { id, title, year: null, format: "Blu-ray", coverUrl: null },
})

const missing = (title: string): ShelfSpine => ({
  ...owned(title, ""),
  status: "missing",
  film: null,
})

/** Put a check's photos in session storage, as if they'd been read. */
async function seedCheck(
  page: Page,
  key: string,
  photos: Array<Array<ShelfSpine>>
) {
  await page.evaluate(
    ([storageKey, value]) => sessionStorage.setItem(storageKey, value),
    [
      key,
      JSON.stringify({
        photos: photos.map((spines, index) => ({
          id: `seeded-${index}`,
          name: `shelf-${index + 1}.jpg`,
          thumbnail: null,
          result: { ok: true, spines },
        })),
      }),
    ]
  )
}

test("a shelf built as stacked shows its discs as a pile, first on top", async ({
  page,
}) => {
  await signUp(page, accountFor("pile-builder"))
  await addFilms(page, ["Cure", "Alien", "Brazil"])

  const shelf = await buildShelf(page, "Floor pile", "Stacked flat")
  await expect(shelf.getByText("stacked", { exact: true })).toBeVisible()

  // Lying flat, one above the other, in the shelf's order.
  const discs = shelf.getByRole("link", { name: /^\d+ / })
  await expect(discs).toHaveText(["1Alien", "2Brazil", "3Cure"])
  const boxes = await Promise.all(
    [0, 1, 2].map(async (i) => (await discs.nth(i).boundingBox())!)
  )
  expect(boxes[0].y).toBeLessThan(boxes[1].y)
  expect(boxes[1].y).toBeLessThan(boxes[2].y)
  expect(boxes[0].width).toBeGreaterThan(boxes[0].height * 4)

  // Saved: a reload keeps the pile, and the builder remembers the choice.
  await page.reload()
  await expect(shelf.getByText("stacked", { exact: true })).toBeVisible()
  const edit = shelf.getByRole("button", { name: "Edit Floor pile" })
  await waitForHydration(edit)
  await edit.click()
  const builder = page.getByRole("dialog", { name: "Edit shelf" })
  await expect(
    builder.getByRole("radio", { name: /Stacked flat/ })
  ).toBeChecked()

  // Standing upright again, the discs are posters side by side.
  await builder.getByText("Standing upright").click()
  await builder.getByRole("button", { name: "Save shelf" }).click()
  await expect(shelf.getByText("stacked", { exact: true })).toBeHidden()
  await expect(discs).toHaveCount(0)
  // Coverless posters show their title in the frame and beneath it.
  await expect(shelf.getByText("Alien", { exact: true })).toHaveCount(2)
})

test("a shelf's order check says what to move, in the stack's words", async ({
  page,
}) => {
  await signUp(page, accountFor("order-checker"))
  const ids = await addFilms(page, ["Alien", "Brazil", "Cure", "Dune"])
  const id = (title: string) => ids.get(title)!

  const shelf = await buildShelf(page, "Floor pile", "Stacked flat")
  const orderLink = shelf.getByRole("button", {
    name: "Check the order of Floor pile with a photo",
  })
  const shelfId = new URL(
    (await orderLink.getAttribute("href"))!,
    "http://spine.test"
  ).searchParams.get("shelf")!

  // Two overlapping photos, top to bottom: Dune sits too high, Brazil is
  // seen twice, and one disc isn't catalogued.
  await seedCheck(page, `spine.shelf-check:shelf:${shelfId}`, [
    [owned("Alien", id("Alien")), owned("Dune", id("Dune"))],
    [
      owned("Brazil", id("Brazil")),
      missing("Stalker"),
      owned("Brazil", id("Brazil")),
      owned("Cure", id("Cure")),
    ],
  ])
  await orderLink.click()

  await expect(
    page.getByRole("heading", { name: "Check shelf order" })
  ).toBeVisible()
  await expect(page.getByText("stacked flat, read top to bottom")).toBeVisible()
  await expect(page.getByText("1 to move", { exact: true })).toBeVisible()
  await expect(
    page.getByRole("region", { name: /Moves/ }).getByRole("listitem")
  ).toHaveText(["Move Dune to the bottom, below Cure"])
  await expect(
    page
      .getByRole("region", { name: "The discs as photographed" })
      .getByRole("listitem")
  ).toHaveText([
    "Alien — In place",
    "Dune — Move",
    "Brazil — In place",
    "Stalker — Not catalogued",
    "Cure — In place",
  ])
  await expect(page.getByRole("button", { name: "Mark arranged" })).toBeHidden()

  // Adding the uncatalogued disc comes back to this order check.
  await page.getByRole("button", { name: "Add Stalker" }).click()
  await expect(page.getByLabel("Title *")).toHaveValue("Stalker")
  await page.getByRole("button", { name: "Add to collection" }).click()
  await expect(
    page.getByRole("heading", { name: "Check shelf order" })
  ).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`shelf=${shelfId}`))
  await expect(page.getByRole("link", { name: /Added Stalker/ })).toBeVisible()

  // The catalogue check offers the order check for the shelf its photos
  // look like, with these photos.
  await seedCheck(page, "spine.shelf-check", [
    ["Alien", "Brazil", "Cure", "Dune"].map((title) => owned(title, id(title))),
  ])
  await page.goto("/shelf-check")
  const offer = page.getByRole("region", { name: "Check a shelf's order" })
  await expect(offer).toContainText(
    "Looks like your Floor pile shelf — check its order?"
  )
  const checkOrder = offer.getByRole("button", { name: "Check order" })
  await waitForHydration(checkOrder)
  await checkOrder.click()
  await expect(page).toHaveURL(new RegExp(`shelf=${shelfId}`))
  await expect(page.getByText("All 4 in order", { exact: true })).toBeVisible()

  await page.getByRole("button", { name: "Mark arranged" }).click()
  await expect(page.getByText("Marked arranged", { exact: true })).toBeVisible()
  await expect(page.getByText("“Floor pile” marked arranged")).toBeVisible()
})
