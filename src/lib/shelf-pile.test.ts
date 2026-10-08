import { describe, expect, it } from "vitest"
import { pileCase, pileOffset, shelfOrientation } from "./shelf-pile"

describe("shelfOrientation", () => {
  it("treats a shelf without one as upright", () => {
    expect(shelfOrientation({})).toBe("upright")
    expect(shelfOrientation({ orientation: "stacked" })).toBe("stacked")
  })
})

describe("pileCase", () => {
  it("draws a DVD case longer and thicker than a Blu-ray one", () => {
    const dvd = pileCase({ format: "DVD" })
    const bluray = pileCase({ format: "Blu-ray" })
    const uhd = pileCase({ format: "4K UHD" })
    expect(dvd).toEqual({ length: 1, thickness: 34 })
    expect(bluray.length).toBeCloseTo(170 / 190)
    expect(bluray.thickness).toBe(26)
    expect(uhd.length).toBe(bluray.length)
    expect(uhd.thickness).toBeGreaterThan(bluray.thickness)
  })

  it("thins steelbooks and thickens box sets and many-disc cases", () => {
    const bluray = pileCase({ format: "Blu-ray" }).thickness
    expect(
      pileCase({ format: "Blu-ray", packageType: "Steelbook" }).thickness
    ).toBeLessThan(bluray)
    expect(
      pileCase({ format: "Blu-ray", packageType: "Boxset" }).thickness
    ).toBeGreaterThan(bluray)
    expect(pileCase({ format: "Blu-ray", discCount: 2 }).thickness).toBe(bluray)
    expect(
      pileCase({ format: "Blu-ray", discCount: 4 }).thickness
    ).toBeGreaterThan(bluray)
  })

  it("keeps every case a usable tap target and the biggest within bounds", () => {
    expect(
      pileCase({ format: "Blu-ray", packageType: "Steelbook" }).thickness
    ).toBeGreaterThanOrEqual(24)
    expect(
      pileCase({ format: "DVD", packageType: "Boxset", discCount: 40 })
        .thickness
    ).toBe(64)
  })

  it("falls back to a Blu-ray case for an unknown format", () => {
    expect(pileCase({ format: "LaserDisc" })).toEqual(
      pileCase({ format: "Blu-ray" })
    )
  })
})

describe("pileOffset", () => {
  it("nudges the same case the same way every time, within bounds", () => {
    const ids = Array.from({ length: 200 }, (_, i) => `film-${i}`)
    const offsets = ids.map((id) => pileOffset(id))
    expect(ids.map((id) => pileOffset(id))).toEqual(offsets)
    expect(Math.max(...offsets)).toBeLessThanOrEqual(6)
    expect(Math.min(...offsets)).toBeGreaterThanOrEqual(-6)
    // Spread out, not all the same.
    expect(new Set(offsets).size).toBeGreaterThan(8)
    expect(pileOffset("x", 0)).toBe(0)
  })
})
