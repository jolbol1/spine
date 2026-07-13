import { Camera, CameraOff, Loader2 } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

/**
 * Camera barcode scanner in a dialog — opens the camera immediately and
 * hands the first EAN/UPC hit to `onDetected`, closing itself.
 */
export function BarcodeScanDialog({
  open,
  onOpenChange,
  onDetected,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onDetected: (code: string) => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const scanningRef = useRef(false)
  const cameraRequestRef = useRef(0)
  const [cameraState, setCameraState] = useState<
    "starting" | "active" | "denied"
  >("starting")

  const stopCamera = useCallback(() => {
    cameraRequestRef.current += 1
    scanningRef.current = false
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }, [])

  const startCamera = useCallback(async () => {
    const requestId = cameraRequestRef.current + 1
    cameraRequestRef.current = requestId
    setCameraState("starting")

    // zxing-wasm polyfill: works even where native BarcodeDetector is absent.
    const { BarcodeDetector } = await import("barcode-detector/ponyfill")
    if (cameraRequestRef.current !== requestId) return

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      })
    } catch {
      if (cameraRequestRef.current === requestId) setCameraState("denied")
      return
    }

    if (cameraRequestRef.current !== requestId) {
      stream.getTracks().forEach((track) => track.stop())
      return
    }

    streamRef.current = stream
    const video = videoRef.current
    if (!video) {
      stopCamera()
      return
    }
    video.srcObject = stream
    await video.play()
    if (cameraRequestRef.current !== requestId) return
    setCameraState("active")

    const detector = new BarcodeDetector({
      formats: ["ean_13", "ean_8", "upc_a", "upc_e"],
    })

    scanningRef.current = true
    const tick = async () => {
      if (!scanningRef.current || !videoRef.current) return
      try {
        const codes = await detector.detect(videoRef.current)
        const hit = codes.find((c) => c.rawValue.length >= 8)
        if (hit) {
          stopCamera()
          onOpenChange(false)
          onDetected(hit.rawValue)
          return
        }
      } catch {
        // Frame not ready yet — keep polling.
      }
      setTimeout(tick, 180)
    }
    tick()
  }, [onDetected, onOpenChange, stopCamera])

  useEffect(() => {
    if (open) {
      startCamera()
    } else {
      stopCamera()
    }
    return stopCamera
  }, [open, startCamera, stopCamera])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Scan a barcode</DialogTitle>
        </DialogHeader>
        <div className="bg-secondary relative aspect-video w-full overflow-hidden rounded-md">
          <video
            ref={videoRef}
            playsInline
            muted
            className="absolute inset-0 size-full object-cover"
          />
          {cameraState === "starting" && (
            <div className="absolute inset-0 flex items-center justify-center">
              <Loader2 className="text-muted-foreground size-8 animate-spin" />
            </div>
          )}
          {cameraState === "active" && (
            <div className="border-lb-green/80 pointer-events-none absolute inset-x-[12%] top-1/2 h-24 -translate-y-1/2 rounded-lg border-2 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
          )}
          {cameraState === "denied" && (
            <div className="absolute inset-0 flex items-center justify-center p-4">
              <Alert>
                <CameraOff className="size-4" />
                <AlertTitle>Camera unavailable</AlertTitle>
                <AlertDescription>
                  Permission was denied or no camera was found. Type the
                  barcode into the search box instead.
                </AlertDescription>
              </Alert>
            </div>
          )}
        </div>
        {cameraState === "denied" && (
          <Button variant="outline" className="gap-2" onClick={startCamera}>
            <Camera className="size-4" /> Try again
          </Button>
        )}
        <p className="text-muted-foreground text-xs">
          Point the camera at the disc's UPC/EAN barcode. Matches are looked
          up on Blu-ray.com, then CEX, then the web.
        </p>
      </DialogContent>
    </Dialog>
  )
}
