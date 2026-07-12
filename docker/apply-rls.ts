// Applies drizzle/rls.sql as the admin user. Run after every schema push —
// drizzle-kit does not emit the policy expressions itself.
import { readFileSync } from "node:fs"
import postgres from "postgres"

const url = process.env.DATABASE_URL_ADMIN
if (!url) {
  console.error("DATABASE_URL_ADMIN is required")
  process.exit(1)
}

const sql = postgres(url, { max: 1 })
const file = readFileSync(
  new URL("../drizzle/rls.sql", import.meta.url),
  "utf8",
)
await sql.unsafe(file)
await sql.end()
console.log("RLS policies applied")
