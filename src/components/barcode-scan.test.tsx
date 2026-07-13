// @vitest-environment jsdom

import { act, render } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { BarcodeScanDialog } from "@/components/barcode-scan"

vi.mock("barcode-detector/ponyfill", () => ({
  BarcodeDetector: class {
    detect() {
      return Promise.resolve([])
    }
  },
}))

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
})
