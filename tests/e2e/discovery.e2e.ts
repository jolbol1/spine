import { expect, test } from "@playwright/test"
import { accountFor, addFilm, signUp } from "./support"

test("stats, Oracle, and person pages reflect the collection", async ({
  page,
}) => {
  await signUp(page, accountFor("discovery-owner"))

  await page.getByRole("link", { name: "Stats", exact: true }).click()
  await expect(page.getByText("No stats yet")).toBeVisible()
  await page.getByRole("link", { name: "Oracle", exact: true }).click()
  await expect(page.getByText("The Oracle sees nothing")).toBeVisible()

  await addFilm(page, {
    title: "Stats Fixture",
    director: "Discovery Director",
    year: "2001",
    runtime: "90",
    discCount: "2",
    price: "20",
  })

  await page.getByRole("link", { name: "Oracle", exact: true }).click()
  await expect(page.getByText("1 film fit the bill")).toBeVisible()
  await page.getByRole("button", { name: "Consult the Oracle" }).click()
  await expect(
    page.getByRole("heading", { name: "Stats Fixture", exact: true })
  ).toBeVisible()

  await page
    .getByRole("heading", { name: "Stats Fixture", exact: true })
    .getByRole("link")
    .click()
  await page.getByRole("button", { name: "Mark watched" }).click()
  await expect(page.getByText("Watched", { exact: true })).toBeVisible()

  await page.getByRole("link", { name: "Stats", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Stats" })).toBeVisible()
  await expect(page.getByText("Total discs").locator("..")).toContainText("2")
  await expect(page.getByText("Top-level titles").locator("..")).toContainText(
    "1"
  )
  await expect(page.getByText("Unique directors").locator("..")).toContainText(
    "1"
  )
  await expect(
    page.getByText("Watched", { exact: true }).locator("..")
  ).toContainText("100%")
  await expect(page.getByText("Oldest title").locator("..")).toContainText(
    "2001"
  )
  await expect(page.getByText("Longest runtime").locator("..")).toContainText(
    "1h 30m"
  )
  await expect(page.getByText("Total paid").locator("..")).toContainText(
    "£20.00"
  )
  await expect(page.getByText("2000s")).toBeVisible()

  await page.getByRole("link", { name: "Discovery Director" }).click()
  await expect(
    page.getByRole("heading", { name: "Discovery Director", exact: true })
  ).toBeVisible()
  await expect(page.getByText("directed 1 title")).toBeVisible()
  await expect(
    page.getByRole("link", { name: /Stats Fixture/ }).first()
  ).toBeVisible()
})
