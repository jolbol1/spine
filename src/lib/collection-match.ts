import type { Film } from "@/db/schema"

/**
 * Deciding whether a disc is already in the collection — for the duplicate
 * warning on add/scan and for checking a shelf photo against the catalogue.
 * The iOS app ports this file (ios/Spine/Helpers/CollectionMatch.swift);
 * keep the two in step.
 */

/**
 * A loose title key: case, accents, punctuation, "&"/"and", and a leading
 * article don't count. "The Godfather: Part II" and "godfather part ii" match.
 */
export function titleKey(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .trim()
    .replace(/^(the|a|an)\s+/, "")
    .replace(/[^a-z0-9]/g, "")
}

/**
 * Barcodes compare on digits alone, and a 12-digit UPC-A equals its 13-digit
 * EAN-13 form (a leading 0) — the same disc scans either way.
 */
export function barcodeKey(barcode: string | null | undefined): string | null {
  const digits = (barcode ?? "").replace(/\D/g, "")
  if (digits.length < 8) return null
  return digits.length === 13 && digits.startsWith("0")
    ? digits.slice(1)
    : digits
}

export type DuplicateReason =
  /** Same barcode: this exact disc is already catalogued. */
  | "barcode"
  /** Same title (and year, when both are known) in the same format. */
  | "same-format"
  /** Same title, but the collection has it in another format. */
  | "other-format"

export interface DuplicateMatch {
  film: Film
  reason: DuplicateReason
}

export interface DuplicateCandidate {
  title: string
  year?: number | null
  format?: string | null
  barcode?: string | null
}

const REASON_ORDER: Record<DuplicateReason, number> = {
  barcode: 0,
  "same-format": 1,
  "other-format": 2,
}

/**
 * Films in the collection that look like the disc about to be added, most
 * certain first. `excludeId` leaves out the film being edited.
 */
export function findDuplicates(
  films: readonly Film[],
  candidate: DuplicateCandidate,
  excludeId?: string
): DuplicateMatch[] {
  const barcode = barcodeKey(candidate.barcode)
  const key = titleKey(candidate.title)
  const matches: DuplicateMatch[] = []
  for (const film of films) {
    if (film.id === excludeId) continue
    if (barcode && barcodeKey(film.barcode) === barcode) {
      matches.push({ film, reason: "barcode" })
      continue
    }
    if (!key || titleKey(film.title) !== key) continue
    // Remakes share titles; a year on both sides tells them apart.
    if (
      candidate.year != null &&
      film.year != null &&
      film.year !== candidate.year
    ) {
      continue
    }
    const sameFormat = !candidate.format || candidate.format === film.format
    matches.push({ film, reason: sameFormat ? "same-format" : "other-format" })
  }
  return matches.sort((a, b) => REASON_ORDER[a.reason] - REASON_ORDER[b.reason])
}

/** True when adding would duplicate a disc rather than add another edition. */
export function isSameDisc(matches: readonly DuplicateMatch[]): boolean {
  return matches.some((m) => m.reason !== "other-format")
}
