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

export function formatRuntime(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}
