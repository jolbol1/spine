import Anthropic from "@anthropic-ai/sdk"
import { env } from "@/env"
import {
  SHELF_READING_INSTRUCTIONS,
  SHELF_READING_JSON_SCHEMA,
  collectionListText,
  shelfReadingSchema,
} from "@/lib/shelf-reading"
import type { ShelfReading } from "@/lib/shelf-reading"
import type { Film } from "@/db/schema"

/**
 * Reads the spines in a shelf photo with Claude's vision. Server-only
 * helper: the server function in shelf-scan.ts wraps it, so the SDK never
 * reaches the client bundle.
 */

export type ShelfImageType = "image/jpeg" | "image/png" | "image/webp"

/** A failure worth showing the user as-is. */
export class ShelfReadError extends Error {}

export async function readShelfPhoto(
  image: string,
  mediaType: ShelfImageType,
  collection: readonly Pick<
    Film,
    "title" | "year" | "format" | "label" | "spineNumber"
  >[]
): Promise<ShelfReading> {
  const client = new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    timeout: 180_000,
    maxRetries: 1,
  })

  let response: Anthropic.Beta.BetaMessage
  try {
    response = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      // A declined request is re-run on Anthropic's recommended fallback
      // model rather than coming back as a refusal.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: {
        effort: "medium",
        format: { type: "json_schema", schema: SHELF_READING_JSON_SCHEMA },
      },
      system: [
        { type: "text", text: SHELF_READING_INSTRUCTIONS },
        // The collection is the same for every photo in a session, so it's
        // cached ahead of the image.
        {
          type: "text",
          text: collectionListText(collection),
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType, data: image },
            },
            { type: "text", text: "Read the spines on this shelf." },
          ],
        },
      ],
    })
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      throw new ShelfReadError(
        "The Anthropic API key was rejected — check ANTHROPIC_API_KEY."
      )
    }
    if (err instanceof Anthropic.RateLimitError) {
      throw new ShelfReadError(
        "The vision service is busy — try again in a minute."
      )
    }
    if (err instanceof Anthropic.BadRequestError) {
      throw new ShelfReadError(
        "That photo couldn't be read — try a smaller or clearer image."
      )
    }
    if (err instanceof Anthropic.APIConnectionError) {
      throw new ShelfReadError("Couldn't reach the vision service.")
    }
    if (err instanceof Anthropic.APIError) {
      throw new ShelfReadError(`The vision service failed (${err.status}).`)
    }
    throw err
  }

  if (response.stop_reason === "refusal") {
    throw new ShelfReadError("That photo couldn't be processed.")
  }
  if (response.stop_reason === "max_tokens") {
    throw new ShelfReadError(
      "Too many spines for one photo — photograph part of the shelf at a time."
    )
  }

  const text = response.content.find((block) => block.type === "text")
  let parsed: unknown
  try {
    parsed = JSON.parse(text?.type === "text" ? text.text : "")
  } catch {
    throw new ShelfReadError(
      "The vision service sent back an unreadable answer."
    )
  }
  const reading = shelfReadingSchema.safeParse(parsed)
  if (!reading.success) {
    throw new ShelfReadError(
      "The vision service sent back an unreadable answer."
    )
  }
  return reading.data
}
