import { expect, test } from "@playwright/test"
import type { Page } from "@playwright/test"
import { accountFor, signUp } from "./support"

async function addWishlistItem(page: Page, title: string) {
  await page.getByRole("button", { name: "Add manually" }).click()
  const dialog = page.getByRole("dialog", { name: "Add to wishlist" })
  await dialog.getByLabel("Title *").fill(title)
  await dialog.getByLabel("Year").fill("2025")
  await dialog.getByLabel("Price").fill("£24.99")
  await dialog.getByLabel("Retailer").fill("Fixture Shop")
  await dialog.getByLabel("Notes").fill("Wait for a sale")
  await dialog.getByRole("button", { name: "Save to wishlist" }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByText(title, { exact: true })).toBeVisible()
}

test("wishlist items can be added, isolated, moved, and removed", async ({
  browser,
}) => {
  const ownerContext = await browser.newContext()
  const ownerPage = await ownerContext.newPage()
  await signUp(ownerPage, accountFor("wishlist-owner"))
  await ownerPage.getByRole("link", { name: "Wishlist", exact: true }).click()
  await addWishlistItem(ownerPage, "Wanted Fixture")
  await expect(ownerPage.getByText("Fixture Shop")).toBeVisible()
  await expect(ownerPage.getByText("£24.99")).toBeVisible()
  await expect(ownerPage.getByText("Wait for a sale")).toBeVisible()

  const otherContext = await browser.newContext()
  const otherPage = await otherContext.newPage()
  await signUp(otherPage, accountFor("wishlist-other"))
  await otherPage.getByRole("link", { name: "Wishlist", exact: true }).click()
  await expect(otherPage.getByText("Nothing on the wishlist")).toBeVisible()
  await expect(otherPage.getByText("Wanted Fixture")).toHaveCount(0)

  await ownerPage.getByRole("button", { name: "Own it" }).click()
  await expect(ownerPage.getByText("Nothing on the wishlist")).toBeVisible()
  await ownerPage.getByRole("link", { name: "Collection", exact: true }).click()
  await expect(
    ownerPage.getByRole("link", { name: /Wanted Fixture/ }).first()
  ).toBeVisible()

  await ownerPage.getByRole("link", { name: "Wishlist", exact: true }).click()
  await addWishlistItem(ownerPage, "Remove Fixture")
  await ownerPage.getByRole("button", { name: "Remove from wishlist" }).click()
  await expect(ownerPage.getByText("Nothing on the wishlist")).toBeVisible()

  await ownerContext.close()
  await otherContext.close()
})
