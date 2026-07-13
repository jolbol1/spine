import { z } from "zod"

export const FILM_FORMATS = ["4K UHD", "Blu-ray", "DVD"] as const
export const filmFormatSchema = z.enum(FILM_FORMATS)
export type FilmFormat = z.infer<typeof filmFormatSchema>

export function toCollectionFormat(format: string | null) {
  const result = filmFormatSchema.safeParse(format ?? "Blu-ray")
  if (!result.success) throw new Error(`Unsupported film format: ${format}`)
  return result.data
}
