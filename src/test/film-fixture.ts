import { toSortTitle } from "@/lib/film-helpers"
import type { CastMember, Film, TmdbDetails, WishlistItem } from "@/db/schema"

/**
 * The film shape, written once for tests. Unit tests and end-to-end seeding
 * both build their films here. A new column on the films table thus breaks
 * this file, and only this file.
 *
 * The builder returns a complete `Film` and casts nothing. The type checker
 * therefore still reports a field that the schema no longer has.
 */

let sequence = 0

/** A complete film, with the fields a test cares about supplied as overrides. */
export function filmFixture(overrides: Partial<Film> = {}): Film {
  const count = ++sequence
  const title = overrides.title ?? `Fixture Film ${count}`
  return {
    id: `film-${count}`,
    userId: "u1",
    title,
    sortTitle: toSortTitle(title),
    director: null,
    year: 2000,
    format: "Blu-ray",
    audio: null,
    hdr: null,
    region: null,
    label: null,
    edition: null,
    packageType: null,
    spineNumber: null,
    runtimeMinutes: null,
    discCount: 1,
    barcode: null,
    coverUrl: null,
    notes: null,
    pricePaid: null,
    tmdbId: null,
    tmdbMediaType: "movie",
    tmdbCast: null,
    tmdbDetails: null,
    rtUrl: null,
    rtCriticsScore: null,
    rtAudienceScore: null,
    rtSyncedAt: null,
    letterboxdWatched: false,
    letterboxdWatchedAt: null,
    letterboxdRating: null,
    letterboxdUri: null,
    letterboxdReview: null,
    letterboxdLiked: null,
    watchedOverride: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  }
}

/** Complete TMDB title metadata, for the `tmdbDetails` column. */
export function tmdbDetailsFixture(
  overrides: Partial<TmdbDetails> = {}
): TmdbDetails {
  return {
    imdbId: "tt1234567",
    genres: ["Drama", "Science Fiction"],
    productionCompanies: ["Fixture Studio"],
    productionCountries: ["United Kingdom"],
    originalLanguage: "en",
    budget: 10_000_000,
    revenue: 125_000_000,
    voteAverage: 8.5,
    collection: "Fixture Collection",
    certification: "15",
    ...overrides,
  }
}

/** A complete wishlist item, same contract as `filmFixture`. */
export function wishlistItemFixture(
  overrides: Partial<WishlistItem> = {}
): WishlistItem {
  const count = ++sequence
  return {
    id: `wishlist-${count}`,
    userId: "u1",
    title: `Fixture Wishlist Item ${count}`,
    director: null,
    year: null,
    format: "Blu-ray",
    url: null,
    retailer: null,
    price: null,
    coverUrl: null,
    notes: null,
    createdAt: new Date("2026-01-01"),
    ...overrides,
  }
}

/** One credited performer, for the `tmdbCast` column. */
export function castMemberFixture(
  overrides: Partial<CastMember> = {}
): CastMember {
  return {
    id: 99,
    name: "Fixture Actor",
    character: "Fixture Role",
    profilePath: null,
    ...overrides,
  }
}
