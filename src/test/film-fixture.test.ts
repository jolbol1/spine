import { getTableColumns } from "drizzle-orm"
import { describe, expect, it } from "vitest"
import { films } from "@/db/schema"
import {
  castMemberFixture,
  filmFixture,
  tmdbDetailsFixture,
} from "@/test/film-fixture"

describe("filmFixture", () => {
  it("fills every column the films table declares", () => {
    expect(Object.keys(filmFixture()).sort()).toEqual(
      Object.keys(getTableColumns(films)).sort()
    )
  })

  it("derives the sort title from the title", () => {
    expect(filmFixture({ title: "The Third Man" }).sortTitle).toBe("third man")
  })

  it("gives every film its own id", () => {
    expect(filmFixture().id).not.toBe(filmFixture().id)
  })
})

describe("tmdbDetailsFixture", () => {
  it("fills the detail fields a film stores, and takes overrides", () => {
    const details = tmdbDetailsFixture({ genres: ["Horror"] })

    expect(details.genres).toEqual(["Horror"])
    expect(details.imdbId).toEqual(expect.any(String))
    expect(details.productionCompanies.length).toBeGreaterThan(0)
  })
})

describe("castMemberFixture", () => {
  it("names a performer and takes overrides", () => {
    expect(castMemberFixture({ name: "Second Actor" })).toMatchObject({
      name: "Second Actor",
      character: expect.any(String),
      id: expect.any(Number),
    })
  })
})
