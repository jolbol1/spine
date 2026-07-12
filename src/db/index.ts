import { drizzle } from "drizzle-orm/postgres-js"
import { sql } from "drizzle-orm"
import postgres from "postgres"
import { env } from "@/env"
import * as schema from "./schema"

const client = postgres(env.DATABASE_URL, { max: 10 })

export const db = drizzle(client, { schema })

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * Run queries as a specific user with Postgres row-level security enforced.
 * Sets `app.user_id` for the transaction; RLS policies on the app tables
 * scope every read and write to that user's rows.
 */
export async function withUser<T>(
  userId: string,
  fn: (tx: Tx) => Promise<T>
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`)
    return fn(tx)
  })
}

export * from "./schema"
