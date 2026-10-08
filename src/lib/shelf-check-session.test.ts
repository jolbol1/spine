// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest"
import type * as SessionModule from "./shelf-check-session"
import type { ShelfSpine } from "@/lib/shelf-reading"

const mocks = vi.hoisted(() => ({
  scan: vi.fn(),
  prepare: vi.fn(),
}))

vi.mock("@/server/shelf-scan", () => ({ scanShelfPhotoFn: mocks.scan }))
vi.mock("@/lib/photos", () => ({ prepareShelfPhoto: mocks.prepare }))

type Session = typeof SessionModule

/** A fresh copy of the store, as after a page load. */
async function loadSession(): Promise<Session> {
  vi.resetModules()
  return import("./shelf-check-session")
}

const file = (name: string) => new File(["x"], name, { type: "image/jpeg" })

const spine = (title: string): ShelfSpine => ({
  text: title.toUpperCase(),
  title,
  year: null,
  format: null,
  label: null,
  spineNumber: null,
  legibility: "clear",
  status: "missing",
  film: null,
})

type ScanResult =
  { ok: true; spines: Array<ShelfSpine> } | { ok: false; error: string }

/** A server call the test settles by hand. */
function pendingScan() {
  let resolve!: (value: ScanResult) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<ScanResult>((res, rej) => {
    resolve = res
    reject = rej
  })
  mocks.scan.mockReturnValueOnce(promise)
  return { resolve, reject }
}

const statuses = (
  session: Session,
  context: SessionModule.ShelfCheckContext = "catalogue"
) => session.getShelfPhotos(context).map((photo) => photo.state.status)

beforeEach(() => {
  vi.clearAllMocks()
  sessionStorage.clear()
  mocks.prepare.mockImplementation((f: File) =>
    Promise.resolve({ image: `image-of-${f.name}`, thumbnail: "thumb" })
  )
})

describe("shelf check session", () => {
  it("reads photos one at a time, in order", async () => {
    const session = await loadSession()
    const first = pendingScan()
    const second = pendingScan()

    session.addShelfPhotos("catalogue", [file("left.jpg"), file("right.jpg")])
    await vi.waitFor(() =>
      expect(statuses(session)).toEqual(["reading", "queued"])
    )
    expect(mocks.scan).toHaveBeenCalledOnce()
    expect(mocks.scan.mock.calls[0][0].data).toEqual({
      image: "image-of-left.jpg",
      mediaType: "image/jpeg",
    })

    first.resolve({ ok: true, spines: [spine("Alien")] })
    await vi.waitFor(() =>
      expect(statuses(session)).toEqual(["read", "reading"])
    )
    expect(mocks.scan.mock.calls[1][0].data.image).toBe("image-of-right.jpg")

    second.resolve({ ok: true, spines: [] })
    await vi.waitFor(() => expect(statuses(session)).toEqual(["read", "read"]))
  })

  it("shows a failed photo's error and carries on with the rest", async () => {
    const session = await loadSession()
    const first = pendingScan()
    const second = pendingScan()

    session.addShelfPhotos("catalogue", [file("a.jpg"), file("b.jpg")])
    await vi.waitFor(() => expect(mocks.scan).toHaveBeenCalledOnce())
    first.resolve({
      ok: false,
      error:
        "Reading shelf photos needs ANTHROPIC_API_KEY in the server's .env.",
    })
    await vi.waitFor(() => expect(mocks.scan).toHaveBeenCalledTimes(2))
    second.reject(new TypeError("Failed to fetch"))

    await vi.waitFor(() =>
      expect(statuses(session)).toEqual(["failed", "failed"])
    )
    const [a, b] = session.getShelfPhotos("catalogue")
    expect(a.state).toEqual({
      status: "failed",
      error:
        "Reading shelf photos needs ANTHROPIC_API_KEY in the server's .env.",
      retryable: true,
    })
    expect(b.state).toMatchObject({
      error: expect.stringMatching(/reach the server/),
    })

    // The upload is still in memory, so a retry sends it again.
    const retry = pendingScan()
    session.retryShelfPhoto(a.id)
    await vi.waitFor(() => expect(mocks.scan).toHaveBeenCalledTimes(3))
    expect(mocks.scan.mock.calls[2][0].data.image).toBe("image-of-a.jpg")
    retry.resolve({ ok: true, spines: [spine("Brazil")] })
    await vi.waitFor(() =>
      expect(statuses(session)).toEqual(["read", "failed"])
    )
  })

  it("marks a photo that can't be decoded without stopping the queue", async () => {
    const session = await loadSession()
    mocks.prepare.mockRejectedValueOnce(
      new Error("Couldn't open that image — use a JPEG or PNG photo.")
    )
    pendingScan().resolve({ ok: true, spines: [] })

    session.addShelfPhotos("catalogue", [file("photo.heic"), file("shelf.jpg")])
    await vi.waitFor(() =>
      expect(statuses(session)).toEqual(["failed", "read"])
    )
    expect(session.getShelfPhotos("catalogue")[0].state).toMatchObject({
      retryable: false,
    })
  })

  it("keeps finished photos across a reload, and Start over forgets them", async () => {
    const before = await loadSession()
    pendingScan().resolve({ ok: true, spines: [spine("Casablanca")] })
    before.addShelfPhotos("catalogue", [file("shelf.jpg")])
    await vi.waitFor(() => expect(statuses(before)).toEqual(["read"]))

    const after = await loadSession()
    expect(after.getShelfPhotos("catalogue")).toEqual([
      expect.objectContaining({
        name: "shelf.jpg",
        thumbnail: "thumb",
        state: { status: "read", spines: [spine("Casablanca")] },
      }),
    ])

    after.clearShelfCheck("catalogue")
    expect(after.getShelfPhotos("catalogue")).toEqual([])
    expect((await loadSession()).getShelfPhotos("catalogue")).toEqual([])
  })

  it("abandons the read of a removed photo and moves on", async () => {
    const session = await loadSession()
    const first = pendingScan()
    pendingScan().resolve({ ok: true, spines: [] })

    session.addShelfPhotos("catalogue", [file("wrong.jpg"), file("right.jpg")])
    await vi.waitFor(() => expect(mocks.scan).toHaveBeenCalledOnce())
    const signal = mocks.scan.mock.calls[0][0].signal as AbortSignal

    session.removeShelfPhoto(session.getShelfPhotos("catalogue")[0].id)
    expect(signal.aborted).toBe(true)
    await vi.waitFor(() => expect(statuses(session)).toEqual(["read"]))
    expect(session.getShelfPhotos("catalogue")[0].name).toBe("right.jpg")

    // The abandoned call settling late changes nothing.
    first.resolve({ ok: true, spines: [spine("Ghost")] })
    await Promise.resolve()
    expect(session.getShelfPhotos("catalogue")).toHaveLength(1)
  })

  it("reads an order check's photos in its shelf's direction", async () => {
    const session = await loadSession()
    pendingScan().resolve({ ok: true, spines: [spine("Alien")] })
    session.addShelfPhotos(
      session.orderCheckContext("dvd"),
      [file("pile.jpg")],
      "stacked"
    )
    await vi.waitFor(() =>
      expect(statuses(session, "shelf:dvd")).toEqual(["read"])
    )
    expect(mocks.scan.mock.calls[0][0].data).toMatchObject({
      image: "image-of-pile.jpg",
      arrangement: "stacked",
    })
    // Each check keeps its own photos, here and in storage.
    expect(session.getShelfPhotos("catalogue")).toEqual([])
    expect(sessionStorage.getItem("spine.shelf-check:shelf:dvd")).toContain(
      "Alien"
    )
    expect(sessionStorage.getItem("spine.shelf-check")).toBeNull()
  })

  it("starts an order check from the catalogue check's read photos", async () => {
    const session = await loadSession()
    pendingScan().resolve({ ok: true, spines: [spine("Brazil")] })
    pendingScan() // The second photo is still being read.
    session.addShelfPhotos("catalogue", [file("a.jpg"), file("b.jpg")])
    await vi.waitFor(() =>
      expect(statuses(session)).toEqual(["read", "reading"])
    )

    session.copyShelfCheck("catalogue", "shelf:dvd")
    const copied = session.getShelfPhotos("shelf:dvd")
    expect(copied.map((p) => p.name)).toEqual(["a.jpg"])
    expect(copied[0].id).not.toBe(session.getShelfPhotos("catalogue")[0].id)
    expect(copied[0].state).toEqual({
      status: "read",
      spines: [spine("Brazil")],
    })

    // Starting the order check over leaves the catalogue check alone.
    session.clearShelfCheck("shelf:dvd")
    expect(statuses(session, "shelf:dvd")).toEqual([])
    expect(statuses(session)).toEqual(["read", "reading"])
  })
})
