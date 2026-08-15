import { expect, test } from "@playwright/test"
import { accountFor, addFilm, signUp } from "./support"

test("a collection title can be added, viewed, edited, tracked, and removed", async ({
  page,
}) => {
  const consoleErrors: string[] = []
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text())
  })

  await signUp(page, accountFor("collection-owner"))
  await addFilm(page, {
    title: "A Test Film",
    director: "Ada Director",
    year: "2024",
    runtime: "102",
    barcode: "5012345678900",
    price: "14.99",
    notes: "Reference disc",
  })

  await expect(page.getByText("Directed by")).toContainText("Ada Director")
  await expect(page.getByText("2024", { exact: true })).toBeVisible()
  await expect(page.getByText("1h 42m")).toBeVisible()
  await expect(page.getByText("5012345678900")).toBeVisible()
  await expect(page.getByText("£14.99")).toBeVisible()
  await expect(page.getByText("Reference disc")).toBeVisible()
  await expect(page.getByText("Unwatched", { exact: true })).toBeVisible()

  await page.getByRole("button", { name: "Mark watched" }).click()
  await expect(page.getByText("Watched", { exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: /Follow sync/ })).toBeVisible()

  await page.getByRole("button", { name: "Edit" }).click()
  const dialog = page.getByRole("dialog", { name: "Edit “A Test Film”" })
  await dialog.getByLabel("Title *").fill("The Updated Test Film")
  await dialog.getByLabel("Notes").fill("Updated reference disc")
  await dialog.getByRole("button", { name: "Save changes" }).click()
  await expect(dialog).toBeHidden()
  await expect(
    page.getByRole("heading", { name: "The Updated Test Film", exact: true })
  ).toBeVisible()
  await expect(
    page.getByRole("main").getByText("Updated reference disc")
  ).toBeVisible()

  await page.getByRole("button", { name: "Delete film" }).click()
  await page
    .getByRole("dialog", { name: "Delete “The Updated Test Film”?" })
    .getByRole("button", { name: "Delete" })
    .click()
  await expect(page.getByText("Your shelf is empty")).toBeVisible()
  expect(consoleErrors).toEqual([])
})

test("collection rows are isolated between signed-in users", async ({
  browser,
}) => {
  const ownerContext = await browser.newContext()
  const ownerPage = await ownerContext.newPage()
  await signUp(ownerPage, accountFor("rls-owner"))
  await addFilm(ownerPage, { title: "Owner Only Film" })

  const otherContext = await browser.newContext()
  const otherPage = await otherContext.newPage()
  await signUp(otherPage, accountFor("rls-other"))
  await expect(otherPage.getByText("Your shelf is empty")).toBeVisible()
  await expect(otherPage.getByText("Owner Only Film")).toHaveCount(0)

  await ownerContext.close()
  await otherContext.close()
})

test("collection browse state and saved views survive navigation", async ({
  page,
}) => {
  await signUp(page, accountFor("collection-browser"))
  await addFilm(page, {
    title: "The Alpha Film",
    director: "Browse Director",
    year: "2020",
  })
  await page.getByRole("link", { name: "Collection", exact: true }).click()

  const search = page.getByPlaceholder("Search title, director, spine…")
  await search.fill("missing")
  await expect(page).toHaveURL(/q=missing/)
  await expect(page.getByText("No matches")).toBeVisible()
  await search.fill("Alpha")
  await expect(page).toHaveURL(/q=Alpha/)
  await expect(
    page.getByRole("link", { name: /The Alpha Film/ }).first()
  ).toBeVisible()

  await page.getByRole("button", { name: "List view" }).click()
  await expect(page).toHaveURL(/view=list/)
  await page
    .getByRole("navigation", { name: "Browse alphabetically" })
    .getByRole("button", { name: "A", exact: true })
    .click()
  await expect(page).toHaveURL(/letter=A/)

  await page.getByRole("button", { name: "Views" }).click()
  await page.getByText("Save current view…").click()
  const viewDialog = page.getByRole("dialog", { name: "Save current view" })
  await viewDialog.getByLabel("Name").fill("Alpha list")
  await viewDialog.getByRole("button", { name: "Save view" }).click()
  await expect(page.getByRole("button", { name: "Alpha list" })).toBeVisible()

  await page.goto("/?watched=Unwatched")
  await expect(
    page.getByRole("link", { name: /The Alpha Film/ }).first()
  ).toBeVisible()
  await expect(page.getByRole("button", { name: /Filters/ })).toContainText("1")

  await page
    .getByRole("link", { name: /The Alpha Film/ })
    .first()
    .click()
  await page.getByRole("link", { name: "Browse Director" }).click()
  await expect(
    page.getByRole("heading", { name: "Browse Director", exact: true })
  ).toBeVisible()
  await expect(page.getByText("Directed", { exact: true })).toBeVisible()
  await expect(
    page.getByRole("link", { name: /The Alpha Film/ }).first()
  ).toBeVisible()
})

test("saved views are manageable entirely by keyboard", async ({ page }) => {
  await signUp(page, accountFor("views-keyboarder"))
  await addFilm(page, { title: "Keyboard Film" })
  await page.goto("/")

  // A click straight after goto can land before hydration — retry until
  // the menu actually opens.
  const openViewsMenu = async (name: string) => {
    await expect(async () => {
      await page.getByRole("button", { name }).click()
      await expect(page.getByRole("menu")).toBeVisible({ timeout: 1_000 })
    }).toPass()
  }

  // Seed one saved view (the save dialog is already keyboard-friendly).
  await openViewsMenu("Views")
  await page.getByRole("menuitem", { name: "Save current view…" }).click()
  const saveDialog = page.getByRole("dialog", { name: "Save current view" })
  await saveDialog.getByLabel("Name").fill("Everything")
  await saveDialog.getByRole("button", { name: "Save view" }).click()
  await expect(saveDialog).toBeHidden()

  // Walk the menu with arrows until the wanted item holds focus.
  const arrowTo = async (name: string | RegExp) => {
    const item = page.getByRole("menuitem", { name })
    for (let presses = 0; presses < 10; presses++) {
      if (await item.evaluate((el) => el === document.activeElement)) return
      await page.keyboard.press("ArrowDown")
    }
    await expect(item).toBeFocused()
  }

  // Keyboard only from here: set default, rename, then delete.
  const trigger = page.getByRole("button", { name: "Everything" })
  await trigger.focus()
  await page.keyboard.press("Enter")
  await arrowTo("Set Everything as default view")
  await page.keyboard.press("Enter")
  await expect(
    page.getByRole("menuitem", { name: "Unset Everything as default view" })
  ).toBeVisible()

  await arrowTo("Rename view Everything")
  await page.keyboard.press("Enter")
  const renameDialog = page.getByRole("dialog", { name: "Rename view" })
  await renameDialog.getByLabel("Name").fill("All films")
  await page.keyboard.press("Enter")
  await expect(renameDialog).toBeHidden()

  await expect(page.getByRole("button", { name: "All films" })).toBeVisible()
  await page.getByRole("button", { name: "All films" }).focus()
  await page.keyboard.press("Enter")
  await arrowTo("Delete view All films")
  await page.keyboard.press("Enter")
  await expect(
    page.getByRole("menuitem", { name: "Delete view All films" })
  ).toBeHidden()
})
