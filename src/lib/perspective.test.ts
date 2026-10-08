import { describe, expect, it } from "vitest"
import {
  applyHomography,
  clampToSize,
  coverToSource,
  fitRect,
  isConvexQuad,
  rectQuad,
  solveHomography,
  warpPerspective,
} from "./perspective"
import type { Point, Quad, Raster } from "./perspective"

const expectPoint = (actual: Point, expected: Point) => {
  expect(actual.x).toBeCloseTo(expected.x, 6)
  expect(actual.y).toBeCloseTo(expected.y, 6)
}

/** A cover photographed at an angle: wider at the bottom, leaning right. */
const tilted: Quad = [
  { x: 412.5, y: 310 },
  { x: 1620, y: 268.25 },
  { x: 1810, y: 1712 },
  { x: 288, y: 1650.5 },
]

describe("solveHomography", () => {
  it("sends every corner to its partner", () => {
    const output = rectQuad({ x: 0, y: 0, width: 1052, height: 1200 })
    const h = solveHomography(output, tilted)
    expect(h).not.toBeNull()
    output.forEach((corner, i) =>
      expectPoint(applyHomography(h!, corner), tilted[i])
    )
  })

  it("is the identity for a quad mapped onto itself", () => {
    const h = solveHomography(tilted, tilted)!
    const expected = [1, 0, 0, 0, 1, 0, 0, 0, 1]
    h.forEach((value, i) => expect(value).toBeCloseTo(expected[i], 9))
  })

  it("reduces to scale and offset between upright rectangles", () => {
    const h = solveHomography(
      rectQuad({ x: 0, y: 0, width: 100, height: 50 }),
      rectQuad({ x: 10, y: 20, width: 200, height: 150 })
    )!
    expectPoint(applyHomography(h, { x: 50, y: 25 }), { x: 110, y: 95 })
    expect(h[6]).toBeCloseTo(0, 12)
    expect(h[7]).toBeCloseTo(0, 12)
  })

  it("keeps straight lines straight", () => {
    const h = solveHomography(
      rectQuad({ x: 0, y: 0, width: 10, height: 10 }),
      tilted
    )!
    const a = applyHomography(h, { x: 0, y: 5 })
    const b = applyHomography(h, { x: 5, y: 5 })
    const c = applyHomography(h, { x: 10, y: 5 })
    const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
    expect(Math.abs(cross)).toBeLessThan(1e-6)
  })

  it("refuses degenerate corners", () => {
    const line: Quad = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 20, y: 20 },
      { x: 30, y: 30 },
    ]
    const square = rectQuad({ x: 0, y: 0, width: 10, height: 10 })
    expect(solveHomography(square, line)).toBeNull()
    const point = { x: 5, y: 5 }
    expect(solveHomography(square, [point, point, point, point])).toBeNull()
  })
})

/** A raster whose red channel is the x index and green the y index. */
function coordinateRaster(width: number, height: number): Raster {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      data[i] = x
      data[i + 1] = y
      data[i + 2] = 77
      data[i + 3] = 255
    }
  }
  return { data, width, height }
}

const pixel = (data: Uint8ClampedArray, width: number, x: number, y: number) =>
  Array.from(data.subarray((y * width + x) * 4, (y * width + x) * 4 + 4))

describe("warpPerspective", () => {
  const source = coordinateRaster(256, 256)

  it("copies the image when the corners are its own edges", () => {
    const out = warpPerspective(
      source,
      rectQuad({ x: 0, y: 0, width: 256, height: 256 }),
      { width: 256, height: 256 }
    )!
    expect(out).toEqual(source.data)
  })

  it("crops an upright rectangle exactly", () => {
    const out = warpPerspective(
      source,
      rectQuad({ x: 40, y: 100, width: 32, height: 16 }),
      { width: 32, height: 16 }
    )!
    expect(pixel(out, 32, 0, 0)).toEqual([40, 100, 77, 255])
    expect(pixel(out, 32, 31, 15)).toEqual([71, 115, 77, 255])
  })

  it("samples each output pixel through the homography", () => {
    const corners: Quad = [
      { x: 60, y: 30 },
      { x: 200, y: 50 },
      { x: 230, y: 220 },
      { x: 20, y: 190 },
    ]
    const size = { width: 90, height: 120 }
    const out = warpPerspective(source, corners, size)!
    const h = solveHomography(rectQuad({ x: 0, y: 0, ...size }), corners)!
    for (const [x, y] of [
      [0, 0],
      [45, 60],
      [89, 0],
      [10, 119],
      [77, 33],
    ]) {
      // The coordinate ramps are linear, so bilinear sampling is exact
      // up to the byte rounding.
      const expected = applyHomography(h, { x: x + 0.5, y: y + 0.5 })
      const [r, g, b, a] = pixel(out, size.width, x, y)
      expect(Math.abs(r - (expected.x - 0.5))).toBeLessThanOrEqual(0.5)
      expect(Math.abs(g - (expected.y - 0.5))).toBeLessThanOrEqual(0.5)
      expect([b, a]).toEqual([77, 255])
    }
  })

  it("holds the edge pixel for samples off the image", () => {
    const out = warpPerspective(
      source,
      rectQuad({ x: -10, y: -10, width: 20, height: 20 }),
      { width: 20, height: 20 }
    )!
    expect(pixel(out, 20, 0, 0)).toEqual([0, 0, 77, 255])
  })

  it("returns null for degenerate corners", () => {
    const p = { x: 3, y: 3 }
    expect(
      warpPerspective(source, [p, p, p, p], { width: 4, height: 4 })
    ).toBeNull()
  })
})

describe("isConvexQuad", () => {
  it("accepts corners clockwise from the top-left", () => {
    expect(isConvexQuad(tilted)).toBe(true)
    expect(isConvexQuad(rectQuad({ x: 0, y: 0, width: 4, height: 3 }))).toBe(
      true
    )
  })

  it("rejects crossed, folded, and mirrored corners", () => {
    const [tl, tr, br, bl] = rectQuad({ x: 0, y: 0, width: 10, height: 10 })
    expect(isConvexQuad([tl, tr, bl, br])).toBe(false)
    expect(isConvexQuad([tl, tr, { x: 3, y: 3 }, bl])).toBe(false)
    expect(isConvexQuad([tr, tl, bl, br])).toBe(false)
  })
})

describe("frame helpers", () => {
  it("fits a portrait cover inside a landscape box and centres it", () => {
    expect(fitRect({ width: 1600, height: 900 }, 0.75, 0.8)).toEqual({
      x: 530,
      y: 90,
      width: 540,
      height: 720,
    })
  })

  it("fits by width when the box is narrower than the cover", () => {
    const rect = fitRect({ width: 300, height: 400 }, 131.5 / 150, 0.9)
    expect(rect.width).toBeCloseTo(270)
    expect(rect.height).toBeCloseTo(270 / (131.5 / 150))
    expect(rect.x).toBeCloseTo(15)
  })

  it("maps a cover-fit view back into the source's pixels", () => {
    // A 1920×1080 frame filling a 300×400 box is cropped at the sides.
    const view = { width: 300, height: 400 }
    const source = { width: 1920, height: 1080 }
    expectPoint(coverToSource({ x: 150, y: 200 }, view, source), {
      x: 960,
      y: 540,
    })
    expectPoint(coverToSource({ x: 0, y: 0 }, view, source), {
      x: 960 - 150 * 2.7,
      y: 0,
    })
    expectPoint(coverToSource({ x: 300, y: 400 }, view, source), {
      x: 960 + 150 * 2.7,
      y: 1080,
    })
  })

  it("clamps a point to the image", () => {
    expect(clampToSize({ x: -4, y: 900 }, { width: 640, height: 480 })).toEqual(
      { x: 0, y: 480 }
    )
  })
})
