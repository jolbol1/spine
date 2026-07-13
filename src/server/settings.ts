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

const savedViewSchema = z.object({
  name: z.string().trim().min(1).max(60),
  params: z.record(z.string(), z.string().max(500)),
  isDefault: z.boolean().optional(),
})

/** Replace the user's saved collection views (client sends the full list). */
export const saveViewsFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ views: z.array(savedViewSchema).max(50) }))
  .handler(async ({ context, data }) => {
    const rows = await withUser(context.userId, (tx) =>
      tx
        .insert(userSettings)
        .values({ userId: context.userId, savedViews: data.views })
        .onConflictDoUpdate({
          target: userSettings.userId,
          set: { savedViews: data.views },
        })
        .returning()
    )
    return rows[0]
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
