// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { BarcodeScanDialog } from "@/components/barcode-scan"

const barcode = vi.hoisted(() => ({ detect: vi.fn() }))

vi.mock("barcode-detector/ponyfill", () => ({
  BarcodeDetector: class {
    detect() {
      return barcode.detect()
    }
  },
}))

beforeEach(() => {
  barcode.detect.mockResolvedValue([])
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("BarcodeScanDialog", () => {
  it("stops a camera stream that arrives after the dialog closes", async () => {
    let resolveStream: (stream: MediaStream) => void = () => undefined
    const streamPromise = new Promise<MediaStream>((resolve) => {
      resolveStream = resolve
    })
    const stop = vi.fn()
    const stream = {
      getTracks: () => [{ stop }],
    } as unknown as MediaStream
    const getUserMedia = vi.fn().mockReturnValue(streamPromise)

    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    })

    const { rerender } = render(
      <BarcodeScanDialog open onOpenChange={vi.fn()} onDetected={vi.fn()} />
    )

    await act(async () => {
      await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalledOnce())
    })

    rerender(
      <BarcodeScanDialog
        open={false}
        onOpenChange={vi.fn()}
        onDetected={vi.fn()}
      />
    )

    await act(async () => {
      resolveStream(stream)
      await streamPromise
    })

    expect(stop).toHaveBeenCalledOnce()
  })

  it("explains when camera access is unavailable and allows a retry", async () => {
    const getUserMedia = vi.fn().mockRejectedValue(new Error("denied"))
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    })

    render(
      <BarcodeScanDialog open onOpenChange={vi.fn()} onDetected={vi.fn()} />
    )

    expect(await screen.findByText("Camera unavailable")).toBeTruthy()
    await screen.getByRole("button", { name: "Try again" }).click()
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2))
  })

  it("returns the first UPC/EAN detection and stops the stream", async () => {
    const stop = vi.fn()
    const stream = {
      getTracks: () => [{ stop }],
    } as unknown as MediaStream
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
    })
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue()
    barcode.detect.mockResolvedValue([{ rawValue: "5012345678900" }])
    const onOpenChange = vi.fn()
    const onDetected = vi.fn()

    render(
      <BarcodeScanDialog
        open
        onOpenChange={onOpenChange}
        onDetected={onDetected}
      />
    )

    await waitFor(() => {
      expect(onDetected).toHaveBeenCalledWith("5012345678900")
    })
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(stop).toHaveBeenCalledOnce()
  })
})
