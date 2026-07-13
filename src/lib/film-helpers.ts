import type { Film } from "@/db/schema"

export const FORMATS = ["4K UHD", "Blu-ray", "DVD"] as const
export const PACKAGE_TYPES = [
  "Standard",
  "Steelbook",
  "Digipack",
  "Boxset",
  "Slipcover",
  "Mediabook",
] as const
export const HDR_TYPES = ["HDR10", "HDR10+", "Dolby Vision", "SDR"] as const
export const REGIONS = ["A", "B", "C", "Free", "1", "2", "3", "4"] as const

/** Strip leading articles for alphabetical sorting, à la library catalogues. */
export function toSortTitle(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/^(the|a|an)\s+/i, "")
}

/** First letter bucket for the A–Z browser ("#" for digits/symbols). */
export function sortLetter(film: Pick<Film, "sortTitle">): string {
  const ch = film.sortTitle.charAt(0).toUpperCase()
  return ch >= "A" && ch <= "Z" ? ch : "#"
}

/** Effective watched state: manual override wins, else Letterboxd sync. */
export function isWatched(
  film: Pick<Film, "watchedOverride" | "letterboxdWatched">
): boolean {
  return film.watchedOverride ?? film.letterboxdWatched
}

export function resolutionOf(film: Pick<Film, "format">): string {
  switch (film.format) {
    case "4K UHD":
      return "2160p"
    case "Blu-ray":
      return "1080p"
    case "DVD":
      return "480p/576p"
    default:
      return "Unknown"
  }
}

/** Split a director field into individual names ("A, B" / "A & B"). */
export function directorsOf(film: Pick<Film, "director">): string[] {
  if (!film.director) return []
  return film.director
    .split(/,|&| and /)
    .map((name) => name.trim())
    .filter(Boolean)
}

/** Badge colors per disc format — 4K pops, Blu-ray blue, DVD muted. */
const FORMAT_BADGE_CLASSES: Record<string, string> = {
  "4K UHD": "bg-lb-orange text-[#1b0f04]",
  "Blu-ray": "bg-lb-blue text-[#06131b]",
  DVD: "bg-chart-4 text-[#0b1016]",
}

export function formatBadgeClass(format: string): string {
  return FORMAT_BADGE_CLASSES[format] ?? "bg-secondary text-foreground"
}

/** TMDB budget/revenue figures are USD. */
export function formatUsdCompact(amount: number): string {
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(amount)
}

/** films.price_paid is a numeric column, so it arrives as a string. */
export function formatPrice(value: string | number | null): string | null {
  const n = typeof value === "string" ? Number(value) : value
  if (n == null || !Number.isFinite(n)) return null
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
  }).format(n)
}

export function formatRuntime(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}
