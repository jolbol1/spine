import { useMutation } from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { Camera, CameraOff, Keyboard, Loader2 } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { cleanBlurayTitle } from "@/components/film-form"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { searchBlurayFn } from "@/server/bluray"
import type { BlurayResult } from "@/server/bluray"

export const Route = createFileRoute("/_app/scan")({
  component: ScanPage,
})

function ScanPage() {
  const navigate = useNavigate()
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const scanningRef = useRef(false)

  const [cameraState, setCameraState] = useState<
    "idle" | "starting" | "active" | "denied" | "unsupported"
  >("idle")
  const [barcode, setBarcode] = useState<string | null>(null)
  const [manual, setManual] = useState("")
  const [results, setResults] = useState<BlurayResult[] | null>(null)

  const lookup = useMutation({
    mutationFn: (code: string) => searchBlurayFn({ data: { query: code } }),
    onSuccess: (found, code) => {
      setResults(found)
      if (found.length === 0) {
        toast.info(
          `No Blu-ray.com match for ${code} — you can still add it manually.`
        )
      }
    },
    onError: () => toast.error("Lookup failed"),
  })

  const stopCamera = useCallback(() => {
    scanningRef.current = false
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }, [])

  const onDetected = useCallback(
    (code: string) => {
      stopCamera()
      setCameraState("idle")
      setBarcode(code)
      lookup.mutate(code)
    },
    [lookup, stopCamera]
  )

  const startCamera = useCallback(async () => {
    setResults(null)
    setBarcode(null)
    setCameraState("starting")

    // zxing-wasm polyfill: works even where native BarcodeDetector is absent.
    const { BarcodeDetector } = await import("barcode-detector/ponyfill")

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      })
    } catch {
      setCameraState("denied")
      return
    }

    streamRef.current = stream
    const video = videoRef.current
    if (!video) return
    video.srcObject = stream
    await video.play()
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
          onDetected(hit.rawValue)
          return
        }
      } catch {
        // Frame not ready yet — keep polling.
      }
      setTimeout(tick, 180)
    }
    tick()
  }, [onDetected])

  useEffect(() => stopCamera, [stopCamera])

  function pickResult(result: BlurayResult) {
    navigate({
      to: "/add",
      search: {
        title: cleanBlurayTitle(result.title),
        year: result.year?.toString(),
        coverUrl: result.coverUrl,
        barcode: barcode ?? undefined,
      },
    })
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Scan a barcode</h1>
        <p className="text-sm text-muted-foreground">
          Point your camera at the disc's UPC/EAN barcode — matches come from
          Blu-ray.com.
        </p>
      </div>

      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="relative aspect-video w-full overflow-hidden rounded-md bg-secondary">
            <video
              ref={videoRef}
              playsInline
              muted
              className="absolute inset-0 size-full object-cover"
            />
            {cameraState !== "active" && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                {cameraState === "starting" ? (
                  <Loader2 className="size-8 animate-spin text-muted-foreground" />
                ) : (
                  <>
                    <Camera className="size-8 text-muted-foreground" />
                    <Button onClick={startCamera} className="gap-2">
                      <Camera className="size-4" /> Start camera
                    </Button>
                  </>
                )}
              </div>
            )}
            {cameraState === "active" && (
              <div className="pointer-events-none absolute inset-x-[12%] top-1/2 h-24 -translate-y-1/2 rounded-lg border-2 border-lb-green/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
            )}
          </div>

          {cameraState === "active" && (
            <Button
              variant="outline"
              className="w-full gap-2"
              onClick={() => {
                stopCamera()
                setCameraState("idle")
              }}
            >
              <CameraOff className="size-4" /> Stop camera
            </Button>
          )}

          {cameraState === "denied" && (
            <Alert>
              <CameraOff className="size-4" />
              <AlertTitle>Camera unavailable</AlertTitle>
              <AlertDescription>
                Permission was denied or no camera was found. Type the barcode
                below instead.
              </AlertDescription>
            </Alert>
          )}

          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              const code = manual.trim()
              if (!code) return
              setBarcode(code)
              setResults(null)
              lookup.mutate(code)
            }}
          >
            <div className="relative flex-1">
              <Keyboard className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                inputMode="numeric"
                placeholder="Or type the barcode, e.g. 715515186612"
                className="pl-8"
              />
            </div>
            <Button type="submit" disabled={lookup.isPending}>
              {lookup.isPending && <Loader2 className="size-4 animate-spin" />}
              Look up
            </Button>
          </form>
        </CardContent>
      </Card>

      {barcode && (
        <p className="text-center text-sm text-muted-foreground">
          Barcode <span className="font-mono text-foreground">{barcode}</span>
          {lookup.isPending && " — searching Blu-ray.com…"}
        </p>
      )}

      {results && results.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">
            Pick the matching release
          </h2>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
            {results.map((result) => (
              <button
                key={result.url}
                type="button"
                onClick={() => pickResult(result)}
                className="group rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="relative aspect-2/3 overflow-hidden rounded-md bg-secondary ring-1 ring-transparent transition group-hover:ring-2 group-hover:ring-lb-green">
                  <img
                    src={result.coverUrl}
                    alt={result.title}
                    loading="lazy"
                    className="absolute inset-0 size-full object-cover"
                  />
                </div>
                <p className="mt-1 line-clamp-2 text-xs leading-tight">
                  {result.title}
                </p>
              </button>
            ))}
          </div>
        </div>
      )}

      {results && results.length === 0 && barcode && (
        <div className="text-center">
          <Button
            variant="outline"
            onClick={() => navigate({ to: "/add", search: { barcode } })}
          >
            Add manually with barcode {barcode}
          </Button>
        </div>
      )}
    </div>
  )
}
