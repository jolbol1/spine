import { expect, test } from "@playwright/test"
import postgres from "postgres"
import { accountFor, addFilm, signUp } from "./support"

async function enrichFixture() {
  const sql = postgres(process.env.DATABASE_URL_ADMIN!, { max: 1 })
  try {
    await sql`
      update films
      set
        tmdb_id = 4242,
        tmdb_media_type = 'movie',
        tmdb_cast = ${sql.json([
          {
            id: 99,
            name: "Fixture Actor",
            character: "Fixture Role",
            profilePath: null,
          },
        ])},
        tmdb_details = ${sql.json({
          imdbId: "tt1234567",
          genres: ["Drama", "Science Fiction"],
          productionCompanies: ["Fixture Studio"],
          productionCountries: ["United Kingdom"],
          originalLanguage: "en",
          budget: 10_000_000,
          revenue: 125_000_000,
          voteAverage: 8.5,
          collection: "Fixture Collection",
          certification: "15",
        })},
        rt_url = 'https://www.rottentomatoes.com/m/stats_fixture',
        rt_critics_score = 85,
        rt_audience_score = 92,
        rt_synced_at = now()
      where title = 'Stats Fixture'
    `
  } finally {
    await sql.end()
  }
}

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
  await enrichFixture()
  await page.reload()

  await expect(page.getByText("🍅 85%")).toBeVisible()
  await expect(page.getByText("🍿 92%")).toBeVisible()
  await expect(page.getByText("Drama · Science Fiction")).toBeVisible()
  await expect(page.getByRole("link", { name: /Fixture Actor/ })).toBeVisible()
  await expect(page.getByText("Fixture Studio")).toBeVisible()
  await expect(page.getByText("United Kingdom")).toBeVisible()
  await expect(page.getByRole("button", { name: "TMDB" })).toBeVisible()
  await expect(page.getByRole("button", { name: "IMDb" })).toBeVisible()

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
  await expect(page.getByText("$125M").first()).toBeVisible()
  await expect(page.getByText("Fixture Studio")).toBeVisible()
  await expect(page.getByText("Science Fiction")).toBeVisible()

  await page.getByRole("link", { name: "Fixture Actor" }).click()
  await expect(
    page.getByRole("heading", { name: "Fixture Actor", exact: true })
  ).toBeVisible()
  await expect(page.getByText("appears in 1 title")).toBeVisible()
  await expect(page.getByText("Acted in", { exact: true })).toBeVisible()
  await expect(page.getByText("as Fixture Role")).toBeVisible()
  await expect(
    page.getByRole("link", { name: /Stats Fixture/ }).first()
  ).toBeVisible()
})
