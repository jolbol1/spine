import { useCallback, useSyncExternalStore } from "react"
import { prepareShelfPhoto } from "@/lib/photos"
import { parseShelfCheck, serializeShelfCheck } from "@/lib/shelf-check"
import type { StoredShelfPhoto } from "@/lib/shelf-check"
import type { ShelfSpine } from "@/lib/shelf-reading"
import type { ShelfOrientation } from "@/db/schema"
import { scanShelfPhotoFn } from "@/server/shelf-scan"

/**
 * Shelf checks in progress. They live outside React so photos keep being
 * read while the user steps away — to add a missing disc, say — and are
 * all there when they come back. Finished photos also go to session
 * storage, so a reload keeps the results; the uploads themselves are held
 * in memory only.
 *
 * Each check keeps its own photos: the catalogue check (what isn't in the
 * collection), and one order check per shelf. Photos from all of them are
 * read one at a time, in the order they were added.
 */

/** Which check photos belong to. */
export type ShelfCheckContext = "catalogue" | `shelf:${string}`

export const orderCheckContext = (shelfId: string): ShelfCheckContext =>
  `shelf:${shelfId}`

export type ShelfPhotoState =
  | { status: "preparing" }
  | { status: "queued" }
  | { status: "reading"; startedAt: number }
  | { status: "read"; spines: Array<ShelfSpine> }
  | { status: "failed"; error: string; retryable: boolean }

export interface ShelfPhoto {
  id: string
  name: string
  thumbnail: string | null
  state: ShelfPhotoState
  /** How the discs sit, so they're read in the shelf's direction. */
  arrangement?: ShelfOrientation
}

const EMPTY: ReadonlyArray<ShelfPhoto> = []

const storageKey = (context: ShelfCheckContext) =>
  context === "catalogue" ? "spine.shelf-check" : `spine.shelf-check:${context}`

const sessions = new Map<ShelfCheckContext, ReadonlyArray<ShelfPhoto>>()
const restored = new Set<ShelfCheckContext>()
const listeners = new Set<() => void>()
/** Downscaled photos waiting to be read, or kept so a failed read can be retried. */
const uploads = new Map<string, string>()
/** Photos are decoded one at a time; several large decodes at once can run a phone out of memory. */
let preparing = Promise.resolve()
let inFlight: { id: string; controller: AbortController } | null = null
let sequence = 0

const newPhotoId = () => `photo-${Date.now().toString(36)}-${++sequence}`

function restore(context: ShelfCheckContext) {
  if (restored.has(context) || typeof window === "undefined") return
  restored.add(context)
  try {
    sessions.set(
      context,
      parseShelfCheck(sessionStorage.getItem(storageKey(context))).map(
        (stored) => ({
          id: stored.id,
          name: stored.name,
          thumbnail: stored.thumbnail,
          state: stored.result.ok
            ? { status: "read", spines: stored.result.spines }
            : {
                status: "failed",
                error: stored.result.error,
                retryable: false,
              },
        })
      )
    )
  } catch {
    // Storage is blocked; start empty.
  }
}

function persist(context: ShelfCheckContext) {
  const finished = (sessions.get(context) ?? EMPTY).flatMap(
    (photo): Array<StoredShelfPhoto> => {
      const { id, name, thumbnail, state } = photo
      if (state.status === "read") {
        return [
          { id, name, thumbnail, result: { ok: true, spines: state.spines } },
        ]
      }
      if (state.status === "failed") {
        return [
          { id, name, thumbnail, result: { ok: false, error: state.error } },
        ]
      }
      return []
    }
  )
  try {
    if (finished.length > 0) {
      sessionStorage.setItem(storageKey(context), serializeShelfCheck(finished))
    } else {
      sessionStorage.removeItem(storageKey(context))
    }
  } catch {
    // Full or blocked — the results still last for this visit.
  }
}

/** The photos of one check right now, restored from session storage on first use. */
export function getShelfPhotos(
  context: ShelfCheckContext
): ReadonlyArray<ShelfPhoto> {
  restore(context)
  return sessions.get(context) ?? EMPTY
}

function commit(context: ShelfCheckContext, next: ReadonlyArray<ShelfPhoto>) {
  sessions.set(context, next)
  persist(context)
  listeners.forEach((listener) => listener())
}

/** The check a photo is in, if it still exists. */
function contextOf(id: string): ShelfCheckContext | null {
  for (const [context, photos] of sessions) {
    if (photos.some((photo) => photo.id === id)) return context
  }
  return null
}

function update(id: string, patch: Partial<Omit<ShelfPhoto, "id">>) {
  const context = contextOf(id)
  if (!context) return
  commit(
    context,
    getShelfPhotos(context).map((photo) =>
      photo.id === id ? { ...photo, ...patch } : photo
    )
  )
}

/** Read the next queued photo, if none is being read. */
function pump() {
  if (inFlight) return
  let next: ShelfPhoto | undefined
  for (const photos of sessions.values()) {
    next = photos.find((photo) => photo.state.status === "queued")
    if (next) break
  }
  if (!next) return
  const { id, arrangement } = next
  const image = uploads.get(id)
  if (!image) {
    update(id, {
      state: {
        status: "failed",
        error: "This photo needs adding again.",
        retryable: false,
      },
    })
    pump()
    return
  }

  const controller = new AbortController()
  inFlight = { id, controller }
  update(id, { state: { status: "reading", startedAt: Date.now() } })
  scanShelfPhotoFn({
    data: { image, mediaType: "image/jpeg", arrangement },
    signal: controller.signal,
  })
    .then(
      (result) => {
        if (result.ok) {
          uploads.delete(id)
          update(id, { state: { status: "read", spines: result.spines } })
        } else {
          update(id, {
            state: { status: "failed", error: result.error, retryable: true },
          })
        }
      },
      () => {
        if (controller.signal.aborted) return
        update(id, {
          state: {
            status: "failed",
            error:
              "Couldn't reach the server — check your connection and try again.",
            retryable: true,
          },
        })
      }
    )
    .finally(() => {
      if (inFlight?.id === id) inFlight = null
      pump()
    })
}

/**
 * Queue photos to be scaled down and read, one at a time, in order. An
 * `arrangement` reads them in that shelf direction.
 */
export function addShelfPhotos(
  context: ShelfCheckContext,
  files: ReadonlyArray<File>,
  arrangement?: ShelfOrientation
) {
  const added = files.map((file): ShelfPhoto => ({
    id: newPhotoId(),
    name: file.name,
    thumbnail: null,
    state: { status: "preparing" },
    arrangement,
  }))
  commit(context, [...getShelfPhotos(context), ...added])
  added.forEach((photo, index) => {
    preparing = preparing.then(async () => {
      if (!contextOf(photo.id)) return
      try {
        const { image, thumbnail } = await prepareShelfPhoto(files[index])
        if (!contextOf(photo.id)) return
        uploads.set(photo.id, image)
        update(photo.id, { thumbnail, state: { status: "queued" } })
        pump()
      } catch (err) {
        update(photo.id, {
          state: {
            status: "failed",
            error:
              err instanceof Error ? err.message : "Couldn't open that image.",
            retryable: false,
          },
        })
      }
    })
  })
}

/** Read a failed photo again, while its upload is still in memory. */
export function retryShelfPhoto(id: string) {
  if (!uploads.has(id)) return
  update(id, { state: { status: "queued" } })
  pump()
}

function forget(ids: ReadonlyArray<string>) {
  for (const id of ids) {
    uploads.delete(id)
    if (inFlight?.id === id) {
      inFlight.controller.abort()
      inFlight = null
    }
  }
}

export function removeShelfPhoto(id: string) {
  const context = contextOf(id)
  if (!context) return
  forget([id])
  commit(
    context,
    getShelfPhotos(context).filter((photo) => photo.id !== id)
  )
  pump()
}

/** Forget a check's photos and results ("Start over"). */
export function clearShelfCheck(context: ShelfCheckContext) {
  forget(getShelfPhotos(context).map((photo) => photo.id))
  commit(context, EMPTY)
  pump()
}

/**
 * Start a check from another's photos — the catalogue check's photos,
 * reused to check a shelf's order. Only photos already read come along.
 */
export function copyShelfCheck(from: ShelfCheckContext, to: ShelfCheckContext) {
  const read = getShelfPhotos(from).filter(
    (photo) => photo.state.status === "read"
  )
  forget(getShelfPhotos(to).map((photo) => photo.id))
  commit(
    to,
    read.map((photo) => ({ ...photo, id: newPhotoId() }))
  )
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useShelfPhotos(
  context: ShelfCheckContext
): ReadonlyArray<ShelfPhoto> {
  const getSnapshot = useCallback(() => getShelfPhotos(context), [context])
  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY)
}
