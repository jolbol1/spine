import { request as httpRequest } from "node:http"
import { expect, test } from "@playwright/test"
import { accountFor, addFilm, signUp } from "./support"
import type { Film } from "@/db/schema"

/**
 * The iOS app's view of the server: bearer-token auth plus the JSON
 * endpoint at /api/v1. Requests go out like URLSession's — no cookies, no
 * Origin, no fetch-metadata headers. (Node's fetch adds Sec-Fetch-Mode,
 * which better-auth answers by demanding an Origin, so it can't stand in.)
 */
const baseURL = "http://127.0.0.1:4173"

interface AppResponse {
  status: number
  headers: Record<string, string | string[] | undefined>
  json: <T>() => T
}

function appRequest(
  path: string,
  { token, body }: { token?: string; body?: unknown } = {}
): Promise<AppResponse> {
  const payload = body === undefined ? "" : JSON.stringify(body)
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      `${baseURL}${path}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token && { Authorization: `Bearer ${token}` }),
        },
      },
      (res) => {
        let text = ""
        res.setEncoding("utf8")
        res.on("data", (chunk: string) => (text += chunk))
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            json: <T>() => JSON.parse(text) as T,
          })
        )
      }
    )
    req.on("error", reject)
    req.end(payload)
  })
}

async function signInAsApp(email: string, password: string) {
  const res = await appRequest("/api/auth/sign-in/email", {
    body: { email, password },
  })
  expect(res.status).toBe(200)
  const token = res.headers["set-auth-token"]
  expect(typeof token).toBe("string")
  return token as string
}

const call = (token: string, name: string, data?: unknown) =>
  appRequest(`/api/v1/${name}`, { token, body: data })

test("one account works on the web and in the app", async ({ page }) => {
  const account = accountFor("native-api-owner")
  await signUp(page, account)
  await addFilm(page, { title: "Added On The Web", year: "1999" })

  const token = await signInAsApp(account.email, account.password)

  const session = (await call(token, "session")).json<{
    user: { email: string }
  }>()
  expect(session.user.email).toBe(account.email)

  const films = (await call(token, "listFilms")).json<Film[]>()
  expect(films.map((f) => f.title)).toEqual(["Added On The Web"])

  const created = await call(token, "createFilm", {
    title: "Added In The App",
    format: "4K UHD",
    year: 2021,
  })
  expect(created.status).toBe(200)
  const film = created.json<Film>()
  expect(film.sortTitle).toBe("added in the app")

  await page.goto(`/films/${film.id}`)
  await expect(
    page.getByRole("heading", { name: "Added In The App" })
  ).toBeVisible()
})

test("the app API rejects bad tokens, bad input, and signed-out sessions", async ({
  page,
}) => {
  const account = accountFor("native-api-guard")
  await signUp(page, account)

  expect((await call("not-a-token", "listFilms")).status).toBe(401)
  // The signed-in browser's session cookie alone is not enough.
  const cookieOnly = await page.request.post("/api/v1/listFilms", {
    headers: { "Content-Type": "text/plain" },
    data: "{}",
  })
  expect(cookieOnly.status()).toBe(401)

  const token = await signInAsApp(account.email, account.password)

  const invalid = await call(token, "createFilm", { title: "" })
  expect(invalid.status).toBe(400)
  expect(invalid.json<{ error: string }>().error).toMatch(/^title: /)

  expect((await call(token, "noSuchFunction")).status).toBe(404)

  const signOut = await appRequest("/api/auth/sign-out", { token, body: {} })
  expect(signOut.status).toBe(200)
  expect((await call(token, "listFilms")).status).toBe(401)
})

test("one user's token never reaches another user's films", async ({
  page,
  browser,
}) => {
  const owner = accountFor("native-api-rls-owner")
  await signUp(page, owner)
  await addFilm(page, { title: "Private Disc" })
  const ownerToken = await signInAsApp(owner.email, owner.password)
  const [ownerFilm] = (await call(ownerToken, "listFilms")).json<Film[]>()

  const otherPage = await browser.newPage()
  const other = accountFor("native-api-rls-other")
  await signUp(otherPage, other)
  const otherToken = await signInAsApp(other.email, other.password)

  expect((await call(otherToken, "listFilms")).json()).toEqual([])
  expect(
    (await call(otherToken, "getFilm", { id: ownerFilm.id })).json()
  ).toBeNull()
  await otherPage.close()
})
