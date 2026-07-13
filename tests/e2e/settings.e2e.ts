import { expect, test } from "@playwright/test"
import { accountFor, signUp } from "./support"

test("settings persist per user and optional backfills fail safely", async ({
  browser,
}) => {
  const ownerContext = await browser.newContext()
  const ownerPage = await ownerContext.newPage()
  await signUp(ownerPage, accountFor("settings-owner"))
  await ownerPage.getByRole("button", { name: "Account menu" }).click()
  await ownerPage.getByText("Settings", { exact: true }).click()

  const username = ownerPage.getByLabel("Letterboxd username")
  await expect(
    ownerPage.getByRole("button", { name: "Sync now" })
  ).toBeDisabled()
  await username.fill("fixture_user")
  await ownerPage.getByRole("button", { name: "Save", exact: true }).click()
  await expect(ownerPage.getByText("Settings saved")).toBeVisible()
  await expect(
    ownerPage.getByRole("button", { name: "Sync now" })
  ).toBeEnabled()

  await ownerPage.getByRole("button", { name: "Fetch missing cast" }).click()
  await expect(
    ownerPage.getByText("Set TMDB_API_KEY in .env to enable cast lookups.")
  ).toBeVisible()
  await ownerPage.getByRole("button", { name: "Fetch missing details" }).click()
  await expect(
    ownerPage.getByText("Set TMDB_API_KEY in .env to enable TMDB lookups.")
  ).toBeVisible()
  await ownerPage.getByRole("button", { name: "Fetch missing scores" }).click()
  await expect(
    ownerPage.getByText("All films already have Rotten Tomatoes scores")
  ).toBeVisible()

  await ownerPage.getByRole("link", { name: "Collection", exact: true }).click()
  await ownerPage.getByRole("button", { name: "Account menu" }).click()
  await ownerPage.getByText("Settings", { exact: true }).click()
  await expect(ownerPage.getByLabel("Letterboxd username")).toHaveValue(
    "fixture_user"
  )

  const otherContext = await browser.newContext()
  const otherPage = await otherContext.newPage()
  await signUp(otherPage, accountFor("settings-other"))
  await otherPage.getByRole("button", { name: "Account menu" }).click()
  await otherPage.getByText("Settings", { exact: true }).click()
  await expect(otherPage.getByLabel("Letterboxd username")).toHaveValue("")
  await expect(
    otherPage.getByRole("button", { name: "Sync now" })
  ).toBeDisabled()

  await ownerContext.close()
  await otherContext.close()
})
