import { describe, expect, it, vi } from "vitest"
import {
  JPEG_QUALITIES,
  SHELF_PHOTO_MAX_EDGE,
  encodeWithinBudget,
  fitWithin,
} from "./photos"
import type { Size } from "./perspective"

describe("fitWithin", () => {
  it("scales a phone photo's long edge down to the limit", () => {
    expect(
      fitWithin({ width: 4032, height: 3024 }, SHELF_PHOTO_MAX_EDGE)
    ).toEqual({ width: 2576, height: 1932 })
    expect(
      fitWithin({ width: 3024, height: 4032 }, SHELF_PHOTO_MAX_EDGE)
    ).toEqual({ width: 1932, height: 2576 })
  })

  it("never scales up", () => {
    expect(fitWithin({ width: 1200, height: 900 }, 2576)).toEqual({
      width: 1200,
      height: 900,
    })
  })

  it("keeps a sliver at least a pixel wide", () => {
    expect(fitWithin({ width: 10000, height: 2 }, 100)).toEqual({
      width: 100,
      height: 1,
    })
  })
})

describe("encodeWithinBudget", () => {
  /** A fake encoder whose output length is pixels × quality ÷ 10. */
  const fakeEncoder = () =>
    vi.fn((size: Size, quality: number) =>
      Promise.resolve(
        "x".repeat(Math.round((size.width * size.height * quality) / 10))
      )
    )

  it("keeps the best quality when it already fits", async () => {
    const encode = fakeEncoder()
    const result = await encodeWithinBudget(
      { width: 100, height: 100 },
      1000,
      encode
    )
    expect(result.quality).toBe(JPEG_QUALITIES[0])
    expect(encode).toHaveBeenCalledOnce()
  })

  it("steps the quality down until the photo fits", async () => {
    const encode = fakeEncoder()
    // 100×100 at q gives 1000·q characters; 700 fits from q = 0.65.
    const result = await encodeWithinBudget(
      { width: 100, height: 100 },
      700,
      encode
    )
    expect(result.quality).toBe(0.65)
    expect(result.size).toEqual({ width: 100, height: 100 })
    expect(result.base64.length).toBeLessThanOrEqual(700)
    expect(encode.mock.calls.map(([, q]) => q)).toEqual([0.85, 0.75, 0.65])
  })

  it("shrinks the photo once even the lowest quality is too big", async () => {
    const encode = fakeEncoder()
    const result = await encodeWithinBudget(
      { width: 100, height: 100 },
      300,
      encode
    )
    expect(result.size).toEqual({ width: 80, height: 80 })
    expect(result.base64.length).toBeLessThanOrEqual(300)
  })

  it("gives up rather than looping forever", async () => {
    await expect(
      encodeWithinBudget({ width: 100, height: 100 }, 0, () =>
        Promise.resolve("never small enough")
      )
    ).rejects.toThrow("too large")
  })
})
