import { defineConfig } from "drizzle-kit"

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    // Admin connection (table owner) — migrations only. The app itself
    // connects as the non-superuser `movie_app` role so RLS is enforced.
    url: process.env.DATABASE_URL_ADMIN ?? "postgres://localhost:5432/movie",
  },
})
