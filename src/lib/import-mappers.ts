/** Map each import source's payload onto the film form's values. */
import { emptyFilmValues } from "@/components/film-form"
import type { FilmFormValues } from "@/components/film-form"
import type { BlurayImport } from "@/server/bluray"
import type { CexImport } from "@/server/cex"

/** Map the free-text HDR line from Blu-ray.com onto the form's options. */
export function normalizeHdr(hdr: string | null): string {
  if (!hdr) return ""
  if (hdr.includes("Dolby Vision")) return "Dolby Vision"
  if (hdr.includes("HDR10+")) return "HDR10+"
  if (hdr.includes("HDR10")) return "HDR10"
  return ""
}

export function blurayToValues(data: BlurayImport): FilmFormValues {
  return {
    ...emptyFilmValues,
    title: data.title,
    director: data.director ?? "",
    year: data.year?.toString() ?? "",
    format: data.format,
    audio: data.audio ?? "",
    hdr: normalizeHdr(data.hdr),
    region: data.region?.split(",")[0]?.trim() ?? "",
    label: data.label ?? "",
    spineNumber: data.spineNumber?.toString() ?? "",
    runtimeMinutes: data.runtimeMinutes?.toString() ?? "",
    discCount: data.discCount.toString(),
    coverUrl: data.coverUrl ?? "",
  }
}

/** CEX disc details → form values; catalogue extras land in the notes. */
export function cexToValues(data: CexImport): FilmFormValues {
  const notes = [
    data.bbfcRating && `BBFC: ${data.bbfcRating}`,
    data.genres.length > 0 && `Genre: ${data.genres.join(", ")}`,
    data.publisher && `Publisher: ${data.publisher}`,
    data.supplier && `Supplier: ${data.supplier}`,
  ]
    .filter(Boolean)
    .join("\n")
  return {
    ...emptyFilmValues,
    title: data.title,
    year: data.year?.toString() ?? "",
    format: data.format,
    label: data.label ?? "",
    runtimeMinutes: data.runtimeMinutes?.toString() ?? "",
    coverUrl: data.coverUrl ?? "",
    barcode: data.barcode,
    notes,
  }
}

interface ScrapedProduct {
  title: string
  price: string | null
  retailer: string
  imageUrl: string | null
  url: string
}

/** Retailer product page (via the wishlist scraper) → form values. */
export function scrapeToValues(data: ScrapedProduct): FilmFormValues {
  const raw = data.title
  const year = raw.match(/\((19|20)\d{2}\)/)?.[0]?.slice(1, 5) ?? ""
  const format = /4k|uhd|ultra hd/i.test(raw)
    ? "4K UHD"
    : /\bdvd\b/i.test(raw)
      ? "DVD"
      : "Blu-ray"
  const title = raw
    .replace(/\s*[([][^)\]]*(4K|UHD|Blu-?ray|DVD|Ultra HD)[^)\]]*[)\]]/gi, " ")
    .replace(/\s*[-–]\s*(4K Ultra HD|Blu-?ray|DVD).*$/i, " ")
    .replace(/\s*\((19|20)\d{2}\)\s*/, " ")
    .replace(/\s+/g, " ")
    .trim()
  return {
    ...emptyFilmValues,
    title: title || raw,
    year,
    format,
    coverUrl: data.imageUrl ?? "",
    notes: [data.retailer, data.price].filter(Boolean).join(" · "),
  }
}

/** Extract the CEX box id from a uk.webuy.com product link. */
export function cexIdFromUrl(url: URL): string | null {
  if (!/(^|\.)webuy\.com$/.test(url.hostname)) return null
  return url.searchParams.get("id")
}
