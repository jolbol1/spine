import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { bearer } from "better-auth/plugins"
import { db } from "@/db"
import * as schema from "@/db/schema"
import { env } from "@/env"

export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
    },
  }),
  emailAndPassword: {
    enabled: true,
  },
  // The iOS app can't hold the session cookie, so it sends the same session
  // as `Authorization: Bearer <token>` — the token comes back in the
  // `set-auth-token` header on sign-in. One account works on web and app.
  plugins: [bearer()],
})

export type Session = typeof auth.$Infer.Session
