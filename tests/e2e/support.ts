import { expect } from "@playwright/test"
import type { Page } from "@playwright/test"

export interface TestAccount {
  name: string
  email: string
  password: string
}

export const accountFor = (slug: string): TestAccount => ({
  name: slug
    .split("-")
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" "),
  email: `${slug}@example.com`,
  password: "correct-horse-battery-staple",
})

export async function signUp(page: Page, account: TestAccount) {
  await page.goto("/signup")
  await page.getByLabel("Name").fill(account.name)
  await page.getByLabel("Email").fill(account.email)
  await page.getByLabel("Password").fill(account.password)
  await page.getByRole("button", { name: "Create account" }).click()
  await expect(page.getByText("Your shelf is empty")).toBeVisible()
}

export async function addFilm(
  page: Page,
  film: {
    title: string
    director?: string
    year?: string
    runtime?: string
    barcode?: string
    price?: string
    notes?: string
  }
) {
  await page.getByRole("button", { name: "Add film", exact: true }).click()
  await page.getByLabel("Title *").fill(film.title)
  if (film.director) await page.getByLabel("Director").fill(film.director)
  if (film.year) await page.getByLabel("Year").fill(film.year)
  if (film.runtime) {
    await page.getByLabel("Runtime (minutes)").fill(film.runtime)
  }
  if (film.barcode) {
    await page.getByLabel("Barcode (UPC/EAN)").fill(film.barcode)
  }
  if (film.price) await page.getByLabel("Price paid").fill(film.price)
  if (film.notes) await page.getByLabel("Notes").fill(film.notes)
  await page.getByRole("button", { name: "Add to collection" }).click()
  await expect(page.getByRole("heading", { name: film.title })).toBeVisible()
}
