/**
 * Flattening a photographed cover. The user marks the cover's four corners
 * on the photo; a homography maps the upright output rectangle onto that
 * quadrilateral, and every output pixel is sampled back from the photo
 * through it. Pure — plain numbers and pixel arrays, no canvas — so the
 * maths is unit-tested.
 */

export interface Point {
  x: number
  y: number
}

export interface Size {
  width: number
  height: number
}

export interface Rect extends Point, Size {}

/** Corners clockwise on screen: top-left, top-right, bottom-right, bottom-left. */
export type Quad = [Point, Point, Point, Point]

/** A 3×3 projective transform, row-major. */
export type Homography = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
]

/** RGBA pixels, row-major — the shape of a canvas's ImageData. */
export interface Raster extends Size {
  data: Uint8ClampedArray
}

export function rectQuad({ x, y, width, height }: Rect): Quad {
  return [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height },
  ]
}

export function mapQuad(quad: Quad, fn: (p: Point) => Point): Quad {
  return [fn(quad[0]), fn(quad[1]), fn(quad[2]), fn(quad[3])]
}

/** The quad with one corner moved. */
export function withCorner(quad: Quad, index: number, p: Point): Quad {
  const next: Quad = [...quad]
  next[index] = p
  return next
}

/** The point `h` sends `p` to. */
export function applyHomography(h: Homography, p: Point): Point {
  const w = h[6] * p.x + h[7] * p.y + h[8]
  return {
    x: (h[0] * p.x + h[1] * p.y + h[2]) / w,
    y: (h[3] * p.x + h[4] * p.y + h[5]) / w,
  }
}

function multiply(a: Homography, b: Homography): Homography {
  const out = new Array<number>(9)
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      out[row * 3 + col] =
        a[row * 3] * b[col] +
        a[row * 3 + 1] * b[3 + col] +
        a[row * 3 + 2] * b[6 + col]
    }
  }
  return out as Homography
}

/**
 * Hartley normalisation: move the points' centroid to the origin and scale
 * them to a mean distance of √2, so the linear system is well conditioned
 * whatever the pixel coordinates are. Returns the transform and its inverse.
 */
function normalizer(points: Quad): [Homography, Homography] | null {
  const cx = points.reduce((sum, p) => sum + p.x, 0) / 4
  const cy = points.reduce((sum, p) => sum + p.y, 0) / 4
  const meanDistance =
    points.reduce((sum, p) => sum + Math.hypot(p.x - cx, p.y - cy), 0) / 4
  if (meanDistance < 1e-12) return null
  const s = Math.SQRT2 / meanDistance
  return [
    [s, 0, -s * cx, 0, s, -s * cy, 0, 0, 1],
    [1 / s, 0, cx, 0, 1 / s, cy, 0, 0, 1],
  ]
}

/** Gauss–Jordan elimination with partial pivoting on an n×(n+1) system. */
function solveLinear(rows: Array<Array<number>>): Array<number> | null {
  const n = rows.length
  for (let col = 0; col < n; col++) {
    let pivot = col
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(rows[row][col]) > Math.abs(rows[pivot][col])) pivot = row
    }
    if (Math.abs(rows[pivot][col]) < 1e-10) return null
    ;[rows[col], rows[pivot]] = [rows[pivot], rows[col]]
    for (let row = 0; row < n; row++) {
      if (row === col) continue
      const factor = rows[row][col] / rows[col][col]
      for (let k = col; k <= n; k++) rows[row][k] -= factor * rows[col][k]
    }
  }
  return rows.map((row, i) => row[n] / row[i])
}

/**
 * The homography that sends each `from` corner to the matching `to`
 * corner, or null when either set is degenerate (three corners in a line).
 */
export function solveHomography(from: Quad, to: Quad): Homography | null {
  const fromNorm = normalizer(from)
  const toNorm = normalizer(to)
  if (!fromNorm || !toNorm) return null

  // u = (h0·x + h1·y + h2) / (h6·x + h7·y + 1), and likewise v, rearranged
  // into two linear equations per point pair.
  const rows: Array<Array<number>> = []
  for (let i = 0; i < 4; i++) {
    const { x, y } = applyHomography(fromNorm[0], from[i])
    const { x: u, y: v } = applyHomography(toNorm[0], to[i])
    rows.push([x, y, 1, 0, 0, 0, -x * u, -y * u, u])
    rows.push([0, 0, 0, x, y, 1, -x * v, -y * v, v])
  }
  const solved = solveLinear(rows)
  if (!solved) return null

  const h = multiply(
    multiply(toNorm[1], [...solved, 1] as Homography),
    fromNorm[0]
  )
  if (Math.abs(h[8]) < 1e-12) return null
  return h.map((value) => value / h[8]) as Homography
}

/**
 * True when the corners, in order, make a convex quadrilateral going
 * clockwise on screen — not crossed, not folded, not mirrored.
 */
export function isConvexQuad(quad: Quad): boolean {
  for (let i = 0; i < 4; i++) {
    const a = quad[i]
    const b = quad[(i + 1) % 4]
    const c = quad[(i + 2) % 4]
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)
    // y points down, so a clockwise turn on screen is a positive cross.
    if (cross <= 0) return false
  }
  return true
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

export function clampToSize(p: Point, size: Size): Point {
  return { x: clamp(p.x, 0, size.width), y: clamp(p.y, 0, size.height) }
}

/** The largest `aspect` (width ÷ height) rectangle that fits `fill` of the container, centred. */
export function fitRect(container: Size, aspect: number, fill: number): Rect {
  const maxWidth = container.width * fill
  const maxHeight = container.height * fill
  const width = Math.min(maxWidth, maxHeight * aspect)
  const height = width / aspect
  return {
    x: (container.width - width) / 2,
    y: (container.height - height) / 2,
    width,
    height,
  }
}

/**
 * Where a point in a view that shows `source` with `object-fit: cover`
 * lands in the source's own pixels — the live camera preview crops the
 * frame to fill its box, so its guide frame has to be mapped this way.
 */
export function coverToSource(p: Point, view: Size, source: Size): Point {
  const scale = Math.max(view.width / source.width, view.height / source.height)
  const offsetX = (view.width - source.width * scale) / 2
  const offsetY = (view.height - source.height * scale) / 2
  return { x: (p.x - offsetX) / scale, y: (p.y - offsetY) / scale }
}

/**
 * Flatten the `corners` quadrilateral of `source` into an upright `size`
 * image. Each output pixel's centre is mapped back into the source and
 * sampled bilinearly; samples off the edge take the nearest edge pixel.
 * Returns RGBA pixels for `new ImageData(pixels, size.width, size.height)`,
 * or null when the corners are degenerate.
 */
export function warpPerspective(
  source: Raster,
  corners: Quad,
  size: Size
): Uint8ClampedArray<ArrayBuffer> | null {
  const h = solveHomography(
    rectQuad({ x: 0, y: 0, width: size.width, height: size.height }),
    corners
  )
  if (!h) return null

  const { data, width: sw, height: sh } = source
  const out = new Uint8ClampedArray(size.width * size.height * 4)
  const maxX = sw - 1
  const maxY = sh - 1
  for (let y = 0; y < size.height; y++) {
    const v = y + 0.5
    for (let x = 0; x < size.width; x++) {
      const u = x + 0.5
      const w = h[6] * u + h[7] * v + h[8]
      // Back to pixel-index space, where pixel i's centre is at i.
      const sx = (h[0] * u + h[1] * v + h[2]) / w - 0.5
      const sy = (h[3] * u + h[4] * v + h[5]) / w - 0.5

      const x0 = Math.floor(sx)
      const y0 = Math.floor(sy)
      const fx = clamp(sx - x0, 0, 1)
      const fy = clamp(sy - y0, 0, 1)
      const left = clamp(x0, 0, maxX)
      const right = clamp(x0 + 1, 0, maxX)
      const top = clamp(y0, 0, maxY) * sw
      const bottom = clamp(y0 + 1, 0, maxY) * sw
      const i00 = (top + left) * 4
      const i10 = (top + right) * 4
      const i01 = (bottom + left) * 4
      const i11 = (bottom + right) * 4

      const o = (y * size.width + x) * 4
      for (let c = 0; c < 3; c++) {
        const upper = data[i00 + c] + (data[i10 + c] - data[i00 + c]) * fx
        const lower = data[i01 + c] + (data[i11 + c] - data[i01 + c]) * fx
        out[o + c] = upper + (lower - upper) * fy
      }
      out[o + 3] = 255
    }
  }
  return out
}
