import {
  Camera,
  CameraOff,
  Check,
  Crop,
  ImagePlus,
  Loader2,
  RotateCcw,
  SquareDashed,
} from "lucide-react"
import { useCallback, useEffect, useId, useRef, useState } from "react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { COVER_ASPECT, coverSize } from "@/lib/covers"
import { filmFormatSchema } from "@/lib/film-formats"
import type { FilmFormat } from "@/lib/film-formats"
import {
  clampToSize,
  coverToSource,
  fitRect,
  isConvexQuad,
  mapQuad,
  rectQuad,
  warpPerspective,
  withCorner,
} from "@/lib/perspective"
import type { Point, Quad, Size } from "@/lib/perspective"
import {
  canvasFromPixels,
  drawScaled,
  fitWithin,
  loadImage,
  readPixels,
} from "@/lib/photos"
import { uploadCoverFn } from "@/server/covers"

/** Photos are flattened from at most this many pixels on the long edge. */
const MAX_PHOTO_EDGE = 3072
/** The corner editor draws its preview at most this big. */
const PREVIEW_EDGE = 1280
/** The live view is portrait, like a cover (width ÷ height). */
const VIEW_ASPECT = 3 / 4
/** How much of the live view the guide frame fills. */
const GUIDE_FILL = 0.84
/** Where the corners start on a chosen photo: the cover's shape, this much of the photo. */
const PHOTO_FILL = 0.8
const CORNER_NAMES = ["Top-left", "Top-right", "Bottom-right", "Bottom-left"]

type Step =
  | { kind: "capture" }
  | { kind: "corners"; photo: HTMLCanvasElement; corners: Quad }
  | {
      kind: "result"
      photo: HTMLCanvasElement
      corners: Quad
      /** The flattened cover as a JPEG data URL — previewed and uploaded as-is. */
      jpeg: string
    }

const sizeOf = (canvas: HTMLCanvasElement): Size => ({
  width: canvas.width,
  height: canvas.height,
})

/** Unknown formats get the Blu-ray case's proportions. */
function coverFormat(format: string): FilmFormat {
  return filmFormatSchema.safeParse(format).data ?? "Blu-ray"
}

/**
 * Photograph a disc's front cover and flatten it: capture with the camera
 * (or choose a photo), drag the four corners onto the cover's corners, and
 * the cover is warped upright to its format's exact proportions and stored
 * on the server. `onCover` gets the stored cover's path; the dialog closes
 * once it settles, and an error it throws is shown in the dialog.
 */
export function CoverScanDialog({
  open,
  onOpenChange,
  format,
  onCover,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The film's format, which sets the cover's proportions. */
  format: string
  onCover: (url: string) => Promise<void> | void
}) {
  const resolved = coverFormat(format)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[94svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Scan cover</DialogTitle>
          <DialogDescription>
            Photograph the front cover; it's straightened and cropped to the{" "}
            {resolved} cover's shape.
          </DialogDescription>
        </DialogHeader>
        {/* Mounted only while open, so every opening starts fresh. */}
        <CoverScanner
          format={resolved}
          onCover={async (url) => {
            await onCover(url)
            onOpenChange(false)
          }}
        />
      </DialogContent>
    </Dialog>
  )
}

function CoverScanner({
  format,
  onCover,
}: {
  format: FilmFormat
  onCover: (url: string) => Promise<void>
}) {
  const aspect = COVER_ASPECT[format]
  const [step, setStep] = useState<Step>({ kind: "capture" })
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const instructionsRef = useRef<HTMLParagraphElement>(null)

  // Each new step moves focus to its instructions, so its controls follow
  // in reading order and a screen reader announces the change.
  const shownStep = useRef(step.kind)
  useEffect(() => {
    if (shownStep.current === step.kind) return
    shownStep.current = step.kind
    instructionsRef.current?.focus()
  }, [step.kind])

  const go = (next: Step) => {
    setError(null)
    setStep(next)
  }

  const openFile = async (file: File) => {
    setError(null)
    setBusy("Opening photo…")
    try {
      const image = await loadImage(file)
      const photo = drawScaled(
        image,
        fitWithin(
          { width: image.naturalWidth, height: image.naturalHeight },
          MAX_PHOTO_EDGE
        )
      )
      go({
        kind: "corners",
        photo,
        corners: rectQuad(fitRect(sizeOf(photo), aspect, PHOTO_FILL)),
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't open that photo.")
    } finally {
      setBusy(null)
    }
  }

  const flatten = (photo: HTMLCanvasElement, corners: Quad) => {
    setError(null)
    setBusy("Flattening…")
    // Let the busy state paint before the warp ties up the main thread.
    requestAnimationFrame(() =>
      setTimeout(() => {
        try {
          const size = coverSize(format)
          const pixels = warpPerspective(readPixels(photo), corners, size)
          if (!pixels) {
            setError("Those corners don't outline a cover.")
            return
          }
          const cover = canvasFromPixels(
            new ImageData(pixels, size.width, size.height)
          )
          go({
            kind: "result",
            photo,
            corners,
            jpeg: cover.toDataURL("image/jpeg", 0.85),
          })
        } catch {
          setError("Couldn't flatten the photo — try a smaller one.")
        } finally {
          setBusy(null)
        }
      })
    )
  }

  const save = async (jpeg: string) => {
    setError(null)
    setBusy("Saving cover…")
    try {
      let url: string
      try {
        const result = await uploadCoverFn({
          data: { image: jpeg.slice(jpeg.indexOf(",") + 1) },
        })
        if (!result.ok) {
          setError(result.error)
          return
        }
        url = result.url
      } catch {
        setError(
          "Couldn't upload the cover — check your connection and try again."
        )
        return
      }
      try {
        await onCover(url)
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Couldn't save the cover."
        )
      }
    } finally {
      setBusy(null)
    }
  }

  const { width, height } = coverSize(format)

  return (
    <div className="space-y-3" aria-busy={busy != null}>
      {step.kind === "capture" && (
        <CaptureStep
          aspect={aspect}
          busy={busy}
          instructionsRef={instructionsRef}
          onCapture={(photo, corners) =>
            go({ kind: "corners", photo, corners })
          }
          onFile={openFile}
        />
      )}

      {step.kind === "corners" && (
        <>
          <p
            ref={instructionsRef}
            tabIndex={-1}
            className="text-sm outline-none"
          >
            Drag each corner onto a corner of the cover. A focused corner also
            moves with the arrow keys (Shift for bigger steps).
          </p>
          <CornerEditor
            photo={step.photo}
            corners={step.corners}
            onChange={(corners) => setStep({ ...step, corners })}
          />
          {!isConvexQuad(step.corners) && (
            <p className="text-xs text-destructive">
              The corners cross — put each one on its own corner of the cover.
            </p>
          )}
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => go({ kind: "capture" })}
            >
              <RotateCcw className="size-4" /> Retake
            </Button>
            <Button
              className="flex-1 gap-2"
              disabled={busy != null || !isConvexQuad(step.corners)}
              onClick={() => flatten(step.photo, step.corners)}
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Crop className="size-4" />
              )}
              Flatten
            </Button>
          </div>
        </>
      )}

      {step.kind === "result" && (
        <>
          <p
            ref={instructionsRef}
            tabIndex={-1}
            className="text-sm outline-none"
          >
            The flattened cover, {width} × {height}. Use it, or go back and
            adjust the corners.
          </p>
          <img
            src={step.jpeg}
            alt="The flattened cover"
            width={width}
            height={height}
            className="mx-auto block h-auto max-h-[55svh] w-auto max-w-full rounded-sm ring-1 ring-border"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              className="gap-2"
              disabled={busy != null}
              onClick={() => go({ kind: "capture" })}
            >
              <RotateCcw className="size-4" /> Retake
            </Button>
            <Button
              variant="outline"
              className="gap-2"
              disabled={busy != null}
              onClick={() =>
                go({
                  kind: "corners",
                  photo: step.photo,
                  corners: step.corners,
                })
              }
            >
              <SquareDashed className="size-4" /> Adjust corners
            </Button>
            <Button
              className="flex-1 gap-2"
              disabled={busy != null}
              onClick={() => save(step.jpeg)}
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Check className="size-4" />
              )}
              Use cover
            </Button>
          </div>
        </>
      )}

      <p role="status" className="min-h-4 text-xs text-muted-foreground">
        {busy}
      </p>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}

/** The live camera with the cover's guide frame, or a photo to choose. */
function CaptureStep({
  aspect,
  busy,
  instructionsRef,
  onCapture,
  onFile,
}: {
  aspect: number
  busy: string | null
  instructionsRef: React.RefObject<HTMLParagraphElement | null>
  onCapture: (photo: HTMLCanvasElement, corners: Quad) => void
  onFile: (file: File) => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const viewRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const requestRef = useRef(0)
  const [camera, setCamera] = useState<"starting" | "live" | "unavailable">(
    "starting"
  )
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const request = ++requestRef.current
    let stream: MediaStream | null = null
    const start = async () => {
      // Missing outside a secure context (plain http on the LAN, say).
      if (!("mediaDevices" in navigator)) {
        setCamera("unavailable")
        return
      }
      setCamera("starting")
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "environment",
            width: { ideal: 1920 },
            height: { ideal: 1920 },
          },
          audio: false,
        })
      } catch {
        if (request === requestRef.current) setCamera("unavailable")
        return
      }
      const video = videoRef.current
      if (request !== requestRef.current || !video) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      video.srcObject = stream
      try {
        await video.play()
      } catch {
        // Muted inline playback isn't blocked; a failure shows as no frames.
      }
      if (request === requestRef.current) setCamera("live")
    }
    void start()
    return () => {
      requestRef.current += 1
      stream?.getTracks().forEach((track) => track.stop())
    }
  }, [attempt])

  const capture = () => {
    const video = videoRef.current
    const view = viewRef.current
    if (!video || !view || video.videoWidth === 0) return
    const photo = drawScaled(
      video,
      fitWithin(
        { width: video.videoWidth, height: video.videoHeight },
        MAX_PHOTO_EDGE
      )
    )
    // The guide frame's corners, from the cropped live view into the photo.
    const box = view.getBoundingClientRect()
    const viewSize = { width: box.width, height: box.height }
    const photoSize = sizeOf(photo)
    const corners = mapQuad(
      rectQuad(fitRect(viewSize, aspect, GUIDE_FILL)),
      (p) => clampToSize(coverToSource(p, viewSize, photoSize), photoSize)
    )
    onCapture(photo, corners)
  }

  const guide = fitRect({ width: VIEW_ASPECT, height: 1 }, aspect, GUIDE_FILL)
  const unavailable = camera === "unavailable"

  return (
    <>
      <p ref={instructionsRef} tabIndex={-1} className="text-sm outline-none">
        {unavailable
          ? "Choose a photo of the cover — taken square-on, in good light."
          : "Fit the cover inside the frame, flat and in good light, then capture."}
      </p>
      <div
        ref={viewRef}
        className="relative mx-auto aspect-[3/4] w-full max-w-[calc(58svh*0.75)] overflow-hidden rounded-md bg-secondary"
      >
        <video
          ref={videoRef}
          playsInline
          muted
          aria-label="Camera view"
          className="absolute inset-0 size-full object-cover"
        />
        {camera === "live" && (
          <div
            aria-hidden
            className="pointer-events-none absolute rounded-sm border-2 border-lb-green/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.4)]"
            style={{
              left: `${(guide.x / VIEW_ASPECT) * 100}%`,
              top: `${guide.y * 100}%`,
              width: `${(guide.width / VIEW_ASPECT) * 100}%`,
              height: `${guide.height * 100}%`,
            }}
          />
        )}
        {(camera === "starting" || busy) && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="size-8 animate-spin text-muted-foreground" />
          </div>
        )}
        {unavailable && !busy && (
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <Alert>
              <CameraOff className="size-4" />
              <AlertTitle>Camera unavailable</AlertTitle>
              <AlertDescription>
                Permission was denied, there's no camera, or the page isn't on
                HTTPS. Choose a photo of the cover instead.
              </AlertDescription>
            </Alert>
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {unavailable ? (
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => setAttempt((n) => n + 1)}
          >
            <Camera className="size-4" /> Try the camera again
          </Button>
        ) : (
          <Button
            className="flex-1 gap-2"
            disabled={camera !== "live" || busy != null}
            onClick={capture}
          >
            <Camera className="size-4" /> Capture
          </Button>
        )}
        <Button
          variant={unavailable ? "default" : "outline"}
          className={unavailable ? "flex-1 gap-2" : "gap-2"}
          disabled={busy != null}
          onClick={() => fileRef.current?.click()}
        >
          <ImagePlus className="size-4" /> Choose a photo
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          aria-label="Cover photo"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ""
            if (file) onFile(file)
          }}
        />
      </div>
    </>
  )
}

/** The photo with four draggable corner handles and the outlined cover. */
function CornerEditor({
  photo,
  corners,
  onChange,
}: {
  photo: HTMLCanvasElement
  corners: Quad
  onChange: (corners: Quad) => void
}) {
  const frameRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ index: number; offset: Point } | null>(null)
  const hintId = useId()
  const size = sizeOf(photo)
  const preview = fitWithin(size, PREVIEW_EDGE)
  // Drawn once per photo, not on every drag move.
  const drawPreview = useCallback(
    (canvas: HTMLCanvasElement | null) => {
      canvas
        ?.getContext("2d")
        ?.drawImage(photo, 0, 0, canvas.width, canvas.height)
    },
    [photo]
  )

  /** A pointer position in the photo's own pixels. */
  const toPhoto = (clientX: number, clientY: number): Point | null => {
    const box = frameRef.current?.getBoundingClientRect()
    if (!box || box.width === 0) return null
    return {
      x: ((clientX - box.left) / box.width) * size.width,
      y: ((clientY - box.top) / box.height) * size.height,
    }
  }
  const move = (index: number, p: Point) =>
    onChange(withCorner(corners, index, clampToSize(p, size)))
  const endDrag = () => {
    drag.current = null
  }

  const outline = corners.map((p) => `${p.x},${p.y}`).join(" ")

  return (
    <div
      ref={frameRef}
      className="relative mx-auto w-fit touch-none select-none"
    >
      <canvas
        width={preview.width}
        height={preview.height}
        aria-label="The photo"
        className="block h-auto max-h-[55svh] w-auto max-w-full rounded-sm"
        ref={drawPreview}
      />
      <svg
        aria-hidden
        className="pointer-events-none absolute inset-0 size-full"
        viewBox={`0 0 ${size.width} ${size.height}`}
        preserveAspectRatio="none"
      >
        <path
          d={`M0 0H${size.width}V${size.height}H0Z M${outline.replaceAll(" ", " L")}Z`}
          fillRule="evenodd"
          className="fill-black/45"
        />
        <polygon
          points={outline}
          className="fill-none stroke-lb-green"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <p id={hintId} className="sr-only">
        Drag onto the cover's corner, or use the arrow keys.
      </p>
      {corners.map((corner, index) => (
        <button
          key={CORNER_NAMES[index]}
          type="button"
          aria-label={`${CORNER_NAMES[index]} corner`}
          aria-describedby={hintId}
          className="absolute size-11 -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
          style={{
            left: `${(corner.x / size.width) * 100}%`,
            top: `${(corner.y / size.height) * 100}%`,
          }}
          onPointerDown={(e) => {
            const at = toPhoto(e.clientX, e.clientY)
            if (!at) return
            e.preventDefault()
            e.currentTarget.setPointerCapture(e.pointerId)
            // Keep the grab offset so the corner doesn't jump to the finger.
            drag.current = {
              index,
              offset: { x: at.x - corner.x, y: at.y - corner.y },
            }
          }}
          onPointerMove={(e) => {
            const active = drag.current
            if (active?.index !== index) return
            const at = toPhoto(e.clientX, e.clientY)
            if (!at) return
            move(index, {
              x: at.x - active.offset.x,
              y: at.y - active.offset.y,
            })
          }}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onKeyDown={(e) => {
            const step =
              (e.shiftKey ? 0.02 : 0.004) * Math.max(size.width, size.height)
            const delta: Partial<Record<string, Point>> = {
              ArrowLeft: { x: -step, y: 0 },
              ArrowRight: { x: step, y: 0 },
              ArrowUp: { x: 0, y: -step },
              ArrowDown: { x: 0, y: step },
            }
            const by = delta[e.key]
            if (!by) return
            e.preventDefault()
            move(index, { x: corner.x + by.x, y: corner.y + by.y })
          }}
        >
          <span
            aria-hidden
            className="absolute inset-2.5 rounded-full border-2 border-lb-green bg-lb-green/15 shadow-[0_0_0_1px_rgba(0,0,0,0.6)]"
          />
          <span
            aria-hidden
            className="absolute top-1/2 left-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-lb-green"
          />
        </button>
      ))}
    </div>
  )
}
