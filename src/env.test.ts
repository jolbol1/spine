import { describe, expect, it } from "vitest"
import { resolveEnv } from "@/env"

const DEV_SECRET = "dev-only-secret-change-in-production"
const DEV_DATABASE = "postgres://movie_app:movie_app@localhost:5432/movie"

/** A configured production environment — the shape a real deploy supplies. */
const configured = {
  NODE_ENV: "production",
  DATABASE_URL: "postgres://spine:hunter2@db.internal:5432/spine",
  BETTER_AUTH_SECRET: "a-real-secret",
}

describe("resolveEnv", () => {
  it("boots with no configuration outside production", () => {
    const env = resolveEnv({})

    expect(env.DATABASE_URL).toBe(DEV_DATABASE)
    expect(env.BETTER_AUTH_SECRET).toBe(DEV_SECRET)
    expect(env.BETTER_AUTH_URL).toBe("http://localhost:3000")
  })

  it("refuses to start in production with a default auth secret", () => {
    expect(() =>
      resolveEnv({ ...configured, BETTER_AUTH_SECRET: undefined })
    ).toThrow(/BETTER_AUTH_SECRET/)
  })

  it("refuses to start in production with a default database url", () => {
    expect(() =>
      resolveEnv({ ...configured, DATABASE_URL: undefined })
    ).toThrow(/DATABASE_URL/)
  })

  it("names every unset variable in one message", () => {
    expect(() => resolveEnv({ NODE_ENV: "production" })).toThrow(
      /DATABASE_URL and BETTER_AUTH_SECRET/
    )
  })

  it("refuses when a default is supplied explicitly rather than omitted", () => {
    expect(() =>
      resolveEnv({ ...configured, BETTER_AUTH_SECRET: DEV_SECRET })
    ).toThrow(/BETTER_AUTH_SECRET/)
  })

  it("starts in production once both are set", () => {
    const env = resolveEnv(configured)

    expect(env.DATABASE_URL).toBe(configured.DATABASE_URL)
    expect(env.BETTER_AUTH_SECRET).toBe(configured.BETTER_AUTH_SECRET)
  })

  it("leaves the optional keys alone in production", () => {
    const env = resolveEnv({ ...configured, TMDB_API_KEY: "tmdb-key" })

    expect(env.TMDB_API_KEY).toBe("tmdb-key")
    expect(env.FIRECRAWL_API_KEY).toBeUndefined()
  })

  it("keeps the development auth url default in production", () => {
    // BETTER_AUTH_URL is not guarded — a deploy behind a proxy may legitimately
    // leave it unset. Recorded here so the omission is deliberate, not missed.
    expect(resolveEnv(configured).BETTER_AUTH_URL).toBe("http://localhost:3000")
  })
})
