import { expect, test } from "@playwright/test"
import { accountFor, addFilm, signUp } from "./support"

test("adding a disc already catalogued warns, and still adds another copy", async ({
  page,
}) => {
  await signUp(page, accountFor("duplicate-adder"))
  await addFilm(page, { title: "The Double Film", year: "2019" })

  // The edit dialog doesn't count the film being edited.
  await page.getByRole("button", { name: "Edit" }).click()
  const firstEdit = page.getByRole("dialog", { name: "Edit “The Double Film”" })
  await expect(firstEdit.getByLabel("Title *")).toHaveValue("The Double Film")
  await expect(firstEdit.getByText("Already in your collection.")).toBeHidden()
  await page.keyboard.press("Escape")
  await expect(firstEdit).toBeHidden()

  await page.getByRole("button", { name: "Add film", exact: true }).click()
  await page.getByLabel("Title *").fill("double film")
  await page.getByLabel("Year").fill("2019")

  const warning = page
    .getByRole("status")
    .filter({ hasText: "You may already have this disc" })
  await expect(warning).toContainText("The Double Film (2019) · Blu-ray")
  await expect(warning).toContainText("Already in your collection.")
  await expect(
    warning.getByRole("link", {
      name: "Open The Double Film (2019) in a new tab",
    })
  ).toHaveAttribute("target", "_blank")

  await page.getByRole("button", { name: "Add another copy" }).click()
  await expect(
    page.getByRole("heading", { name: "double film", exact: true })
  ).toBeVisible()

  // Editing the new copy warns about the first one, without relabelling Save.
  await page.getByRole("button", { name: "Edit" }).click()
  const secondEdit = page.getByRole("dialog", { name: "Edit “double film”" })
  await expect(
    secondEdit.getByText("The Double Film (2019) · Blu-ray")
  ).toBeVisible()
  await expect(
    secondEdit.getByRole("button", { name: "Save changes" })
  ).toBeVisible()
})
