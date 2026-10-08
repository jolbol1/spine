/**
 * Server-side environment with local-dev defaults so the app boots
 * without any configuration. Override via .env / process env.
 *
 * The defaults are for development only. Two of them are unsafe in
 * production — the auth secret signs session cookies, and the database URL
 * names a local role — so production refuses to start while either still
 * holds its default. `docker/start.sh` guards the secret for the container
 * path; this guard covers every other way the app is started, and covers
 * `DATABASE_URL`, which the script does not check.
 */

/** The development defaults, named so the guard can recognise them. */
const DEV_DEFAULTS = {
  DATABASE_URL: "postgres://movie_app:movie_app@localhost:5432/movie",
  BETTER_AUTH_SECRET: "dev-only-secret-change-in-production",
  BETTER_AUTH_URL: "http://localhost:3000",
} as const

/** Defaults that must never reach production. */
const UNSAFE_IN_PRODUCTION = ["DATABASE_URL", "BETTER_AUTH_SECRET"] as const

export interface Env {
  /** App connection — non-superuser role, subject to row-level security. */
  DATABASE_URL: string
  BETTER_AUTH_SECRET: string
  BETTER_AUTH_URL: string
  /** Optional: use Firecrawl for wishlist scraping when direct fetch fails. */
  FIRECRAWL_API_KEY: string | undefined
  /** Optional: TMDB v3 API key (or v4 read token) for cast enrichment. */
  TMDB_API_KEY: string | undefined
  /** Optional: Anthropic API key for reading disc spines in shelf photos. */
  ANTHROPIC_API_KEY: string | undefined
}

/**
 * Resolve the environment, applying development defaults.
 *
 * Throws when running in production with a default still in place, naming
 * every offending variable in one message so a misconfigured deploy is fixed
 * in one pass rather than one restart at a time.
 */
export function resolveEnv(
  source: Record<string, string | undefined>,
  nodeEnv: string | undefined = source.NODE_ENV
): Env {
  const resolved: Env = {
    DATABASE_URL: source.DATABASE_URL ?? DEV_DEFAULTS.DATABASE_URL,
    BETTER_AUTH_SECRET:
      source.BETTER_AUTH_SECRET ?? DEV_DEFAULTS.BETTER_AUTH_SECRET,
    BETTER_AUTH_URL: source.BETTER_AUTH_URL ?? DEV_DEFAULTS.BETTER_AUTH_URL,
    FIRECRAWL_API_KEY: source.FIRECRAWL_API_KEY,
    TMDB_API_KEY: source.TMDB_API_KEY,
    ANTHROPIC_API_KEY: source.ANTHROPIC_API_KEY,
  }

  if (nodeEnv === "production") {
    const unset = UNSAFE_IN_PRODUCTION.filter(
      (name) => resolved[name] === DEV_DEFAULTS[name]
    )
    if (unset.length > 0) {
      throw new Error(
        `Refusing to start in production: ${unset.join(" and ")} ` +
          `${unset.length === 1 ? "is" : "are"} still set to the ` +
          `development default. Set ${unset.length === 1 ? "it" : "them"} ` +
          `in the environment before starting Spine.`
      )
    }
  }

  return resolved
}

export const env = resolveEnv(process.env)
