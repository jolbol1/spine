import { fileURLToPath } from "node:url"
import { expect, test } from "@playwright/test"
import { accountFor, signUp, waitForHydration } from "./support"

const shelfPhoto = fileURLToPath(
  new URL("./fixtures/cover-photo.png", import.meta.url)
)
const missingKey =
  "Reading shelf photos needs ANTHROPIC_API_KEY in the server's .env."

test("Shelf check shows the server's reason a photo couldn't be read", async ({
  page,
}) => {
  await signUp(page, accountFor("shelf-checker"))

  // Reached from the Add page and from Shelves.
  await page.getByRole("button", { name: "Add film", exact: true }).click()
  await expect(
    page.getByRole("button", { name: "Shelf check" })
  ).toHaveAttribute("href", "/shelf-check")
  await page.goto("/shelves")
  await page.getByRole("button", { name: "Shelf check" }).click()
  await expect(
    page.getByRole("heading", { name: "Shelf check", exact: true })
  ).toBeVisible()

  // The e2e server has no Anthropic key, so the read fails with its message.
  const photos = page.getByLabel("Shelf photos", { exact: true })
  await waitForHydration(photos)
  await photos.setInputFiles(shelfPhoto)
  await expect(page.getByText(missingKey)).toBeVisible()
  await expect(page.getByRole("status")).toHaveText(
    "Read 0 of 1 photo · 1 couldn't be read"
  )
  await expect(page.getByText("Photo 1 · cover-photo.png")).toBeVisible()

  // The check survives a reload, until Start over.
  await page.reload()
  await expect(page.getByText(missingKey)).toBeVisible()
  const startOver = page.getByRole("button", { name: "Start over" })
  await waitForHydration(startOver)
  await startOver.click()
  await expect(page.getByText(missingKey)).toBeHidden()
  await page.reload()
  await expect(
    page.getByRole("heading", { name: "Shelf check", exact: true })
  ).toBeVisible()
  await expect(page.getByText(missingKey)).toBeHidden()
})
