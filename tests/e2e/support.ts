import { expect } from "@playwright/test"
import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"
import { films } from "@/db/schema"
import { filmFixture } from "@/test/film-fixture"
import type { Locator, Page } from "@playwright/test"
import type { Film } from "@/db/schema"

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
    discCount?: string
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
  if (film.discCount) await page.getByLabel("Disc count").fill(film.discCount)
  if (film.barcode) {
    await page.getByLabel("Barcode (UPC/EAN)").fill(film.barcode)
  }
  if (film.price) await page.getByLabel("Price paid").fill(film.price)
  if (film.notes) await page.getByLabel("Notes").fill(film.notes)
  await page.getByRole("button", { name: "Add to collection" }).click()
  await expect(page.getByRole("heading", { name: film.title })).toBeVisible()
}

/** The columns the application assigns. A seed must not write them. */
type AppAssigned = "id" | "userId" | "createdAt" | "updatedAt"

/**
 * Give the film with this title the state that only an external source can
 * make: TMDB cast, scores, a sync stamp.
 *
 * The write uses a complete film from the builder that the unit tests use.
 * A new column on the films table thus needs no edit here.
 *
 * The seed replaces every column that the builder fills. Give this function
 * all the state that the film must have, not the form that made the row.
 * The admin role makes the write, because it bypasses row-level security.
 */
export async function seedFilm(
  title: string,
  columns: Partial<Omit<Film, AppAssigned>>
): Promise<void> {
  // The application assigns these four. The seed leaves them as they are.
  const { id, userId, createdAt, updatedAt, ...row } = filmFixture({
    title,
    ...columns,
  })

  const sql = postgres(process.env.DATABASE_URL_ADMIN!, { max: 1 })
  try {
    await drizzle(sql).update(films).set(row).where(eq(films.title, title))
  } finally {
    await sql.end()
  }
}

/**
 * Wait until React has hydrated this element. A click before hydration
 * still follows a server-rendered link, but an event that only a React
 * handler acts on — a file input's change, say — would be lost.
 */
export async function waitForHydration(locator: Locator) {
  await expect
    .poll(() =>
      locator.evaluate((el) =>
        Object.keys(el).some((key) => key.startsWith("__reactProps"))
      )
    )
    .toBe(true)
}
