import { expect, test } from "@playwright/test"
import { accountFor, addFilm, savedShelves, signUp } from "./support"

test("a film that leaves the collection leaves the shelves with it", async ({
  page,
}) => {
  const account = accountFor("shelf-arranger")
  await signUp(page, account)
  await addFilm(page, { title: "The Alpha Film" })
  const alphaId = page.url().split("/films/")[1]

  await page.getByRole("link", { name: "Shelves", exact: true }).click()
  await page.getByRole("button", { name: /By format/ }).click()

  // The film is a Blu-ray, so the Blu-ray shelf claims it. Pin it to the 4K
  // shelf instead — a reference the saved layout holds by film id.
  const bluray = page.getByRole("region", { name: "Shelf: Blu-ray" })
  await bluray.getByRole("link", { name: "The Alpha Film" }).hover()
  await page
    .getByRole("button", { name: "Shelf options for The Alpha Film" })
    .click()
  await page.getByRole("menuitem", { name: "Pin to 4K UHD" }).click()
  await expect(
    page
      .getByRole("region", { name: "Shelf: 4K UHD" })
      .getByRole("link", { name: "The Alpha Film" })
  ).toBeVisible()
  const before = await savedShelves(account.email)
  expect(before.some((s) => s.pinned?.includes(alphaId))).toBe(true)

  await page.getByRole("link", { name: "Collection", exact: true }).click()
  await page
    .getByRole("link", { name: /The Alpha Film/ })
    .first()
    .click()
  await page.getByRole("button", { name: "Delete film" }).click()
  await page
    .getByRole("dialog", { name: "Delete “The Alpha Film”?" })
    .getByRole("button", { name: "Delete" })
    .click()
  await expect(page.getByText("Your shelf is empty")).toBeVisible()

  const after = await savedShelves(account.email)
  expect(after).toHaveLength(3)
  expect(after.some((s) => s.pinned?.includes(alphaId))).toBe(false)
  expect(after.some((s) => s.excluded?.includes(alphaId))).toBe(false)
  expect(after.some((s) => s.manualOrder?.includes(alphaId))).toBe(false)
})
