import { createServerFn } from "@tanstack/react-start"
import { z } from "zod"
import { userSettings, withUser } from "@/db"
import { eq } from "drizzle-orm"
import { authMiddleware } from "@/server/middleware"

export const getSettingsFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const rows = await withUser(context.userId, (tx) =>
      tx
        .select()
        .from(userSettings)
        .where(eq(userSettings.userId, context.userId))
        .limit(1)
    )
    return rows.at(0) ?? null
  })

export const saveSettingsFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      letterboxdUsername: z
        .string()
        .trim()
        .max(100)
        .regex(/^[a-zA-Z0-9_-]*$/, "Invalid Letterboxd username")
        .nullable(),
    })
  )
  .handler(async ({ context, data }) => {
    const rows = await withUser(context.userId, (tx) =>
      tx
        .insert(userSettings)
        .values({
          userId: context.userId,
          letterboxdUsername: data.letterboxdUsername || null,
        })
        .onConflictDoUpdate({
          target: userSettings.userId,
          set: { letterboxdUsername: data.letterboxdUsername || null },
        })
        .returning()
    )
    return rows[0]
  })
