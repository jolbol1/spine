import type { Size } from "@/lib/perspective"

/**
 * Getting phone photos ready to send: decode, scale down, JPEG-encode under
 * a size budget. The sizing rules are pure and unit-tested; the canvas
 * helpers below them run in the browser only.
 */

/** Shelf photos are read at up to this many pixels on the long edge — the model's full resolution. */
export const SHELF_PHOTO_MAX_EDGE = 2576

/** Reverse proxies often cap request bodies near 2 MB; keep each photo's base64 under this. */
export const SHELF_PHOTO_MAX_BASE64 = 1_500_000

/** Qualities tried in turn until the encoded photo fits its budget. */
export const JPEG_QUALITIES = [0.85, 0.75, 0.65, 0.55, 0.45] as const

/** Each further shrink once even the lowest quality is too big. */
const SHRINK_STEP = 0.8
const MAX_SHRINKS = 6

/** `size` scaled down, never up, so its long edge is at most `maxEdge`. */
export function fitWithin(size: Size, maxEdge: number): Size {
  const longEdge = Math.max(size.width, size.height)
  if (longEdge <= maxEdge) return { width: size.width, height: size.height }
  const scale = maxEdge / longEdge
  return {
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale)),
  }
}

export interface EncodedPhoto {
  /** Base64 without a `data:` prefix. */
  base64: string
  size: Size
  quality: number
}

/**
 * Encode at the best quality that fits `maxBase64`, stepping the quality
 * down and then the dimensions. `encode` turns a size and a JPEG quality
 * into base64.
 */
export async function encodeWithinBudget(
  size: Size,
  maxBase64: number,
  encode: (size: Size, quality: number) => Promise<string>
): Promise<EncodedPhoto> {
  let current = size
  for (let shrink = 0; shrink <= MAX_SHRINKS; shrink++) {
    for (const quality of JPEG_QUALITIES) {
      const base64 = await encode(current, quality)
      if (base64.length <= maxBase64) return { base64, size: current, quality }
    }
    current = {
      width: Math.max(1, Math.round(current.width * SHRINK_STEP)),
      height: Math.max(1, Math.round(current.height * SHRINK_STEP)),
    }
  }
  throw new Error("That photo is too large to send.")
}

// ---- Browser helpers ----------------------------------------------------

/** Decode an image file. The browser applies its EXIF orientation. */
export async function loadImage(file: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file)
  const image = new Image()
  image.src = url
  try {
    await image.decode()
  } catch {
    throw new Error("Couldn't open that image — use a JPEG or PNG photo.")
  } finally {
    URL.revokeObjectURL(url)
  }
  return image
}

function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("This browser can't process images.")
  return ctx
}

/** A canvas holding `source` drawn at `size`. */
export function drawScaled(
  source: CanvasImageSource,
  size: Size
): HTMLCanvasElement {
  const canvas = document.createElement("canvas")
  canvas.width = size.width
  canvas.height = size.height
  const ctx = context2d(canvas)
  ctx.imageSmoothingQuality = "high"
  ctx.drawImage(source, 0, 0, size.width, size.height)
  return canvas
}

/** The canvas's pixels, read back for processing. */
export function readPixels(canvas: HTMLCanvasElement): ImageData {
  return context2d(canvas).getImageData(0, 0, canvas.width, canvas.height)
}

/** A canvas holding these pixels. */
export function canvasFromPixels(pixels: ImageData): HTMLCanvasElement {
  const canvas = document.createElement("canvas")
  canvas.width = pixels.width
  canvas.height = pixels.height
  context2d(canvas).putImageData(pixels, 0, 0)
  return canvas
}

/** JPEG base64 (no `data:` prefix) of a canvas. */
export async function canvasToBase64(
  canvas: HTMLCanvasElement,
  quality: number
): Promise<string> {
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", quality)
  )
  if (!blob) throw new Error("Couldn't encode the photo.")
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error("Couldn't encode the photo."))
    reader.readAsDataURL(blob)
  })
  return dataUrl.slice(dataUrl.indexOf(",") + 1)
}

const imageSize = (image: HTMLImageElement): Size => ({
  width: image.naturalWidth,
  height: image.naturalHeight,
})

/**
 * A shelf photo ready to send — scaled to the model's resolution and
 * squeezed under the body budget — plus a small thumbnail data URL.
 */
export async function prepareShelfPhoto(
  file: Blob
): Promise<{ image: string; thumbnail: string }> {
  const image = await loadImage(file)
  const original = imageSize(image)
  let canvas = drawScaled(image, fitWithin(original, SHELF_PHOTO_MAX_EDGE))
  const { base64 } = await encodeWithinBudget(
    { width: canvas.width, height: canvas.height },
    SHELF_PHOTO_MAX_BASE64,
    (size, quality) => {
      if (size.width !== canvas.width) canvas = drawScaled(image, size)
      return canvasToBase64(canvas, quality)
    }
  )
  const thumbnail = drawScaled(image, fitWithin(original, 320)).toDataURL(
    "image/jpeg",
    0.7
  )
  return { image: base64, thumbnail }
}
