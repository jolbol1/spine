/**
 * Server-side environment with local-dev defaults so the app boots
 * without any configuration. Override via .env / process env.
 */
export const env = {
  /** App connection — non-superuser role, subject to row-level security. */
  DATABASE_URL:
    process.env.DATABASE_URL ??
    "postgres://movie_app:movie_app@localhost:5432/movie",
  BETTER_AUTH_SECRET:
    process.env.BETTER_AUTH_SECRET ?? "dev-only-secret-change-in-production",
  BETTER_AUTH_URL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  /** Optional: use Firecrawl for wishlist scraping when direct fetch fails. */
  FIRECRAWL_API_KEY: process.env.FIRECRAWL_API_KEY,
  /** Optional: TMDB v3 API key (or v4 read token) for cast enrichment. */
  TMDB_API_KEY: process.env.TMDB_API_KEY,
}
