import { sql } from "drizzle-orm"
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgPolicy,
  pgTable,
  real,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core"

/** One credited performer, as stored in films.tmdb_cast. */
export interface CastMember {
  id: number
  name: string
  character: string | null
  profilePath: string | null
}

/**
 * A saved collection-page view: a name plus the URL search params it
 * restores (filters, sort, poster info, list/grid, …).
 */
export interface SavedView {
  name: string
  params: Record<string, string>
  isDefault?: boolean
}

/** Title-level TMDB metadata, as stored in films.tmdb_details. */
export interface TmdbDetails {
  imdbId: string | null
  genres: string[]
  productionCompanies: string[]
  productionCountries: string[]
  originalLanguage: string | null
  /** USD — 0/unknown stored as null. Movies only. */
  budget: number | null
  revenue: number | null
  /** TMDB community rating, 0–10. */
  voteAverage: number | null
  /** belongs_to_collection.name, e.g. "The Godfather Collection". */
  collection: string | null
  /** Age rating — GB certification preferred, US fallback (e.g. 15, PG). */
  certification?: string | null
}

// ---------------------------------------------------------------------------
// better-auth tables
// ---------------------------------------------------------------------------

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
})

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
})

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
})

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
})

// ---------------------------------------------------------------------------
// App tables — all protected by Postgres row-level security. The app connects
// as a non-superuser role; every query runs inside a transaction that sets
// `app.user_id`, and the policies below scope rows to that user.
// ---------------------------------------------------------------------------

const ownerPolicy = (name: string) =>
  pgPolicy(name, {
    as: "permissive",
    for: "all",
    using: sql`user_id = current_setting('app.user_id', true)`,
    withCheck: sql`user_id = current_setting('app.user_id', true)`,
  })

export const films = pgTable(
  "films",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),

    title: text("title").notNull(),
    /** Title with leading articles stripped, lowercased — for A–Z browse. */
    sortTitle: text("sort_title").notNull(),
    director: text("director"),
    year: integer("year"),

    format: text("format").notNull().default("Blu-ray"), // DVD | Blu-ray | 4K UHD
    audio: text("audio"),
    hdr: text("hdr"), // e.g. HDR10, Dolby Vision, HDR10+ — null for SDR
    region: text("region"), // e.g. A, B, Free, 1, 2
    label: text("label"), // distributor, e.g. Criterion, Arrow, Kino Lorber
    edition: text("edition"), // free text, e.g. Limited Edition, Director's Cut
    packageType: text("package_type"), // Standard | Steelbook | Digipack | Boxset | Slipcover
    spineNumber: integer("spine_number"), // Criterion spine
    runtimeMinutes: integer("runtime_minutes"),
    discCount: integer("disc_count").notNull().default(1),

    barcode: text("barcode"),
    coverUrl: text("cover_url"),
    notes: text("notes"),
    /** What the user paid for this copy, in their own currency. */
    pricePaid: numeric("price_paid", { precision: 10, scale: 2 }),

    /** TMDB enrichment — cast fetched via /search/multi + credits. */
    tmdbId: integer("tmdb_id"),
    tmdbMediaType: text("tmdb_media_type"), // movie | tv
    tmdbCast: jsonb("tmdb_cast").$type<CastMember[]>(),
    tmdbDetails: jsonb("tmdb_details").$type<TmdbDetails>(),

    /** Rotten Tomatoes scores, scraped from rottentomatoes.com. */
    rtUrl: text("rt_url"),
    rtCriticsScore: integer("rt_critics_score"), // Tomatometer, 0–100
    rtAudienceScore: integer("rt_audience_score"), // Popcornmeter, 0–100
    /** Set on every scrape attempt, matched or not — null means never tried. */
    rtSyncedAt: timestamp("rt_synced_at"),

    /** Watched state derived from the Letterboxd sync. */
    letterboxdWatched: boolean("letterboxd_watched").notNull().default(false),
    letterboxdWatchedAt: timestamp("letterboxd_watched_at"),
    /** Star rating (0.5–5) the user gave on Letterboxd, when synced. */
    letterboxdRating: real("letterboxd_rating"),
    /** The user's review/film page on Letterboxd for this title. */
    letterboxdUri: text("letterboxd_uri"),
    /** Review text — from the RSS feed, or the review page for old entries. */
    letterboxdReview: text("letterboxd_review"),
    /** The ♥ on the Letterboxd log entry. */
    letterboxdLiked: boolean("letterboxd_liked"),
    /**
     * Manual per-title override: null = follow Letterboxd sync,
     * true/false = user has pinned the watched state.
     */
    watchedOverride: boolean("watched_override"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("films_user_idx").on(t.userId),
    index("films_user_sort_title_idx").on(t.userId, t.sortTitle),
    index("films_user_spine_idx").on(t.userId, t.spineNumber),
    ownerPolicy("films_owner"),
  ]
).enableRLS()

export const wishlistItems = pgTable(
  "wishlist_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),

    title: text("title").notNull(),
    director: text("director"),
    year: integer("year"),
    format: text("format"),

    url: text("url"),
    retailer: text("retailer"),
    price: text("price"),
    coverUrl: text("cover_url"),
    notes: text("notes"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("wishlist_user_idx").on(t.userId),
    ownerPolicy("wishlist_owner"),
  ]
).enableRLS()

export const userSettings = pgTable(
  "user_settings",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    letterboxdUsername: text("letterboxd_username"),
    lastLetterboxdSyncAt: timestamp("last_letterboxd_sync_at"),
    savedViews: jsonb("saved_views").$type<SavedView[]>(),
  },
  () => [ownerPolicy("user_settings_owner")]
).enableRLS()

/**
 * Global reference data scraped from criterion.com (via Firecrawl) —
 * shared across users, so no RLS.
 */
export const criterionSpines = pgTable(
  "criterion_spines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    spine: integer("spine").notNull(),
    title: text("title").notNull(),
    normalizedTitle: text("normalized_title").notNull(),
    director: text("director"),
    year: integer("year"),
    fetchedAt: timestamp("fetched_at").notNull().defaultNow(),
  },
  (t) => [index("criterion_spines_title_idx").on(t.normalizedTitle)],
)

export type Film = typeof films.$inferSelect
export type NewFilm = typeof films.$inferInsert
export type WishlistItem = typeof wishlistItems.$inferSelect
export type NewWishlistItem = typeof wishlistItems.$inferInsert
export type UserSettings = typeof userSettings.$inferSelect
