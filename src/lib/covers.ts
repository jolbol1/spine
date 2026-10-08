import type { FilmFormat } from "@/lib/film-formats"

/**
 * Covers the user photographs are stored on this server and referenced by a
 * relative cover_url, `/api/covers/<uuid>`, so they keep working if the
 * server's address changes. The iOS app resolves the path against its
 * server.
 */
export const CUSTOM_COVER_PATH =
  /^\/api\/covers\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/

/** The stored cover's id when `url` is one of ours, else null. */
export function customCoverId(url: string | null | undefined): string | null {
  return url?.match(CUSTOM_COVER_PATH)?.[1] ?? null
}

export const coverPath = (id: string) => `/api/covers/${id}`

/**
 * Front-cover proportions (width ÷ height) of the printed insert: a DVD
 * front is 129.5 × 183 mm; Blu-ray and 4K UHD share a case whose front is
 * 131.5 × 150 mm. A scanned cover is flattened to exactly these.
 */
export const COVER_ASPECT: Record<FilmFormat, number> = {
  DVD: 129.5 / 183,
  "Blu-ray": 131.5 / 150,
  "4K UHD": 131.5 / 150,
}

/** Scanned covers are saved this tall, the width following the aspect. */
export const COVER_HEIGHT_PX = 1200

export function coverSize(format: FilmFormat): {
  width: number
  height: number
} {
  return {
    width: Math.round(COVER_HEIGHT_PX * COVER_ASPECT[format]),
    height: COVER_HEIGHT_PX,
  }
}

export type CoverImageType = "image/jpeg" | "image/png" | "image/webp"

/** The image type the bytes actually are, from their magic number. */
export function sniffImageType(bytes: Uint8Array): CoverImageType | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg"
  }
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png"
  }
  const ascii = (from: number, to: number) =>
    String.fromCharCode(...bytes.subarray(from, to))
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp"
  return null
}
