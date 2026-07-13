import { describe, expect, it } from "vitest"
import {
  directorsOf,
  formatBadgeClass,
  formatPrice,
  formatRuntime,
  formatUsdCompact,
  isWatched,
  resolutionOf,
  sortLetter,
  toSortTitle,
} from "./film-helpers"

describe("film metadata helpers", () => {
  it.each([
    ["The Third Man", "third man"],
    ["A Ghost Story", "ghost story"],
    ["An American Friend", "american friend"],
    ["  Paris, Texas  ", "paris, texas"],
  ])("sorts %s as %s", (title, expected) => {
    expect(toSortTitle(title)).toBe(expected)
  })

  it("buckets alphabetic and non-alphabetic sort titles", () => {
    expect(sortLetter({ sortTitle: "alpha" })).toBe("A")
    expect(sortLetter({ sortTitle: "2001" })).toBe("#")
  })

  it("gives a manual watched override precedence over a sync", () => {
    expect(isWatched({ watchedOverride: false, letterboxdWatched: true })).toBe(
      false
    )
    expect(isWatched({ watchedOverride: null, letterboxdWatched: true })).toBe(
      true
    )
  })

  it.each([
    ["4K UHD", "2160p"],
    ["Blu-ray", "1080p"],
    ["DVD", "480p/576p"],
    ["VHS", "Unknown"],
  ])("maps %s to %s", (format, resolution) => {
    expect(resolutionOf({ format })).toBe(resolution)
  })

  it("splits multiple director conventions and removes empty names", () => {
    expect(
      directorsOf({ director: "Lana Wachowski & Lilly Wachowski" })
    ).toEqual(["Lana Wachowski", "Lilly Wachowski"])
    expect(directorsOf({ director: "Joel Coen, Ethan Coen" })).toEqual([
      "Joel Coen",
      "Ethan Coen",
    ])
    expect(directorsOf({ director: null })).toEqual([])
  })

  it("formats runtimes, prices, currencies, and format badges", () => {
    expect(formatRuntime(59)).toBe("59m")
    expect(formatRuntime(125)).toBe("2h 5m")
    expect(formatPrice("14.99")).toBe("£14.99")
    expect(formatPrice("not-a-price")).toBeNull()
    expect(formatUsdCompact(12_500_000)).toMatch(/\$13M|\$12\.5M/)
    expect(formatBadgeClass("4K UHD")).toContain("lb-orange")
    expect(formatBadgeClass("VHS")).toContain("secondary")
  })
})
