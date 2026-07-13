import { expect, test } from "@playwright/test"

const account = {
  name: "Auth Test",
  email: "auth-test@example.com",
  password: "correct-horse-battery-staple",
}

test("a guest can create an account, sign out, and sign back in", async ({
  page,
}) => {
  await page.goto("/")
  await expect(page).toHaveURL(/\/login$/)

  await page.getByRole("link", { name: "Create one" }).click()
  await page.getByLabel("Name").fill(account.name)
  await page.getByLabel("Email").fill(account.email)
  await page.getByLabel("Password").fill(account.password)
  await page.getByRole("button", { name: "Create account" }).click()

  await expect(page.getByText("Your shelf is empty")).toBeVisible()

  await page.getByRole("button", { name: "Account menu" }).click()
  await page.getByText("Sign out", { exact: true }).click()
  await expect(page).toHaveURL(/\/login$/)

  // A returning user commonly lands on a server-rendered login page.
  await page.reload()
  await page.getByLabel("Email").fill(account.email)
  await page.getByLabel("Password").fill(account.password)
  await page.getByRole("button", { name: "Sign in" }).click()

  await expect(page.getByText("Your shelf is empty")).toBeVisible()
})
