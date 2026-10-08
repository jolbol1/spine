import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router"
import {
  ArrowLeft,
  Camera,
  ChevronDown,
  CircleCheck,
  ImagePlus,
  ListOrdered,
  Loader2,
  RotateCcw,
  ScanSearch,
  TriangleAlert,
  X,
} from "lucide-react"
import { useEffect, useId, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { z } from "zod"
import { SmallCover, filmLabel } from "@/components/duplicate-warning"
import { ShelfOrderResults } from "@/components/shelf-order-results"
import { ResultSection, SpineRow } from "@/components/shelf-spine-row"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Progress } from "@/components/ui/progress"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { Film, Shelf, ShelfOrientation } from "@/db/schema"
import { filmsQuery, settingsQuery } from "@/lib/queries"
import {
  joinShelfPhotos,
  mergeShelfSpines,
  shelfCheckSections,
} from "@/lib/shelf-check"
import type { ShelfCheckEntry, ShelfCheckSections } from "@/lib/shelf-check"
import {
  addShelfPhotos,
  clearShelfCheck,
  copyShelfCheck,
  orderCheckContext,
  removeShelfPhoto,
  retryShelfPhoto,
  useShelfPhotos,
} from "@/lib/shelf-check-session"
import type { ShelfCheckContext, ShelfPhoto } from "@/lib/shelf-check-session"
import { READING_WORDS, shelfPhrase } from "@/lib/shelf-moves"
import { checkShelfOrder, guessPhotographedShelf } from "@/lib/shelf-order"
import { shelfOrientation } from "@/lib/shelf-pile"
import type { ShelfSpine } from "@/lib/shelf-reading"
import { cn } from "@/lib/utils"
import { saveShelvesFn } from "@/server/settings"

const searchSchema = z.object({
  /** Check this shelf's order, rather than what isn't catalogued. */
  shelf: z.string().optional(),
})

export const Route = createFileRoute("/_app/shelf-check")({
  validateSearch: searchSchema,
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(filmsQuery),
      context.queryClient.ensureQueryData(settingsQuery),
    ]),
  component: ShelfCheckPage,
})

function ShelfCheckPage() {
  const { shelf: shelfId } = Route.useSearch()
  const { data: films } = useSuspenseQuery(filmsQuery)
  const { data: settings } = useSuspenseQuery(settingsQuery)
  const shelves = useMemo(() => settings?.shelves ?? [], [settings?.shelves])

  if (shelfId == null) return <CatalogueCheck films={films} shelves={shelves} />
  const shelf = shelves.find((s) => s.id === shelfId)
  if (!shelf) {
    return (
      <div className="space-y-4 py-12 text-center">
        <p className="text-muted-foreground">
          That shelf doesn't exist any more.
        </p>
        <Button
          nativeButton={false}
          variant="outline"
          render={<Link to="/shelves" />}
        >
          Back to shelves
        </Button>
      </div>
    )
  }
  return (
    <OrderCheck key={shelf.id} shelf={shelf} films={films} shelves={shelves} />
  )
}

/** Every read photo's spines, in photo order, as the server returned them. */
function useReadSpines(photos: ReadonlyArray<ShelfPhoto>) {
  return useMemo(
    () =>
      photos.flatMap((photo) =>
        photo.state.status === "read" ? [photo.state.spines] : []
      ),
    [photos]
  )
}

/** What isn't catalogued: the check reached from Shelves and Add. */
function CatalogueCheck({
  films,
  shelves,
}: {
  films: Array<Film>
  shelves: Array<Shelf>
}) {
  const photos = useShelfPhotos("catalogue")
  const readPhotos = useReadSpines(photos)
  const spines = useMemo(() => mergeShelfSpines(readPhotos), [readPhotos])
  // Against the collection as it is now, so a title just added shows so.
  const sections = useMemo(
    () => shelfCheckSections(spines, films),
    [spines, films]
  )

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Shelf check</h1>
          <p className="text-sm text-muted-foreground">
            Photograph your shelves and Spine reads the spines, then lists the
            discs that aren't catalogued yet.
          </p>
        </div>
        {photos.length > 0 && (
          <StartOver context="catalogue" confirm={readPhotos.length > 0} />
        )}
      </div>

      <PhotoPicker context="catalogue">
        Stand square-on, close enough that the spine text is sharp. For a long
        shelf take several overlapping photos — a spine seen twice is counted
        once. You can also drop photos here.
      </PhotoPicker>

      {photos.length > 0 && <PhotoList photos={photos} />}

      {readPhotos.length > 0 && shelves.length > 0 && (
        <OrderOffer
          spines={readPhotos.flat()}
          films={films}
          shelves={shelves}
        />
      )}

      {readPhotos.length > 0 && <Results spines={spines} sections={sections} />}
    </div>
  )
}

/**
 * The catalogue check's photos may be of one shelf: offer to check its
 * order with them, on the shelf they look like or another.
 */
function OrderOffer({
  spines,
  films,
  shelves,
}: {
  spines: ReadonlyArray<ShelfSpine>
  films: Array<Film>
  shelves: Array<Shelf>
}) {
  const navigate = useNavigate()
  const guess = useMemo(
    () => guessPhotographedShelf(spines, films, shelves),
    [spines, films, shelves]
  )
  const [choice, setChoice] = useState<string | null>(null)
  const selectedId = choice ?? guess?.id ?? shelves[0].id
  const pickerId = useId()

  const checkOrder = () => {
    copyShelfCheck("catalogue", orderCheckContext(selectedId))
    void navigate({ to: "/shelf-check", search: { shelf: selectedId } })
  }

  return (
    <section
      aria-label="Check a shelf's order"
      className="flex flex-wrap items-end gap-3 rounded-lg border border-lb-blue/40 bg-lb-blue/10 p-4"
    >
      <div className="min-w-48 flex-1 space-y-1">
        <p className="flex items-center gap-2 text-sm font-medium">
          <ListOrdered className="size-4 shrink-0 text-lb-blue" />
          {guess
            ? `Looks like ${shelfPhrase(guess.name)} — check its order?`
            : "Check a shelf's order with these photos?"}
        </p>
        <p className="text-xs text-muted-foreground">
          Works best when the photos run from one end of the shelf to the other,
          in order.
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <label htmlFor={pickerId} className="block text-xs">
            Shelf
          </label>
          <Select
            value={selectedId}
            items={Object.fromEntries(shelves.map((s) => [s.id, s.name]))}
            onValueChange={(id) => setChoice(id)}
          >
            <SelectTrigger id={pickerId} className="min-w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {shelves.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button className="gap-2" onClick={checkOrder}>
          <ListOrdered className="size-4" /> Check order
        </Button>
      </div>
    </section>
  )
}

const ORIENTATION_TEXT: Record<ShelfOrientation, string> = {
  upright: "standing upright",
  stacked: "stacked flat",
}

const ORDER_PHOTO_TIPS: Record<ShelfOrientation, string> = {
  upright:
    "Photograph the shelf from one end to the other, left to right. For a long shelf take several photos in that order, each overlapping the last.",
  stacked:
    "Photograph the pile from top to bottom. For a tall pile take several photos in that order, each overlapping the last.",
}

/** Whether a photographed shelf is in its order, and what to move. */
function OrderCheck({
  shelf,
  films,
  shelves,
}: {
  shelf: Shelf
  films: Array<Film>
  shelves: Array<Shelf>
}) {
  const context = orderCheckContext(shelf.id)
  const orientation = shelfOrientation(shelf)
  const photos = useShelfPhotos(context)
  const readPhotos = useReadSpines(photos)
  const check = useMemo(
    () => checkShelfOrder(joinShelfPhotos(readPhotos), shelf, films, shelves),
    [readPhotos, shelf, films, shelves]
  )

  const queryClient = useQueryClient()
  const [arrangedAt, setArrangedAt] = useState<string | null>(null)
  const markArranged = useMutation({
    mutationFn: (now: string) =>
      saveShelvesFn({
        data: {
          shelves: shelves.map((s) =>
            s.id === shelf.id ? { ...s, arrangedAt: now } : s
          ),
        },
      }),
    onSuccess: async (_result, now) => {
      setArrangedAt(now)
      await queryClient.invalidateQueries({ queryKey: ["settings"] })
      toast.success(`“${shelf.name}” marked arranged`)
    },
    onError: () => toast.error("Could not save shelves"),
  })

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Check shelf order
          </h1>
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{shelf.name}</span> ·{" "}
            {ORIENTATION_TEXT[orientation]}, read{" "}
            {READING_WORDS[orientation].direction}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            nativeButton={false}
            variant="outline"
            className="gap-2"
            render={<Link to="/shelves" />}
          >
            <ArrowLeft className="size-4" /> Shelves
          </Button>
          {photos.length > 0 && (
            <StartOver context={context} confirm={readPhotos.length > 0} />
          )}
        </div>
      </div>

      <PhotoPicker context={context} arrangement={orientation}>
        {ORDER_PHOTO_TIPS[orientation]}
      </PhotoPicker>

      {photos.length > 0 && <PhotoList photos={photos} />}

      {readPhotos.length > 0 && (
        <ShelfOrderResults
          check={check}
          films={films}
          orientation={orientation}
          markArranged={{
            pending: markArranged.isPending,
            done: arrangedAt != null,
            onMark: () => markArranged.mutate(new Date().toISOString()),
          }}
        />
      )}
    </div>
  )
}

/** Start a check over — after confirming, once it has results. */
function StartOver({
  context,
  confirm,
}: {
  context: ShelfCheckContext
  confirm: boolean
}) {
  const [confirming, setConfirming] = useState(false)
  return (
    <>
      <Button
        variant="outline"
        className="gap-2"
        onClick={() =>
          confirm ? setConfirming(true) : clearShelfCheck(context)
        }
      >
        <RotateCcw className="size-4" /> Start over
      </Button>
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Start over?</DialogTitle>
            <DialogDescription>
              This clears the photos and what was read from them.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                clearShelfCheck(context)
                setConfirming(false)
              }}
            >
              Start over
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

/** Take or choose shelf photos, or drop them in. */
function PhotoPicker({
  context,
  arrangement,
  children,
}: {
  context: ShelfCheckContext
  arrangement?: ShelfOrientation
  /** How to photograph the shelf. */
  children: React.ReactNode
}) {
  const cameraRef = useRef<HTMLInputElement>(null)
  const libraryRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const addFiles = (list: FileList | null) => {
    const files = Array.from(list ?? []).filter(
      (file) => file.type === "" || file.type.startsWith("image/")
    )
    if (files.length > 0) addShelfPhotos(context, files, arrangement)
  }
  const onInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    addFiles(e.target.files)
    e.target.value = ""
  }

  return (
    <div
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setDragging(false)
        }
      }}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        addFiles(e.dataTransfer.files)
      }}
      className={cn(
        "flex flex-col items-center gap-3 rounded-lg border-2 border-dashed p-6 text-center transition-colors",
        dragging ? "border-lb-green bg-lb-green/5" : "border-border"
      )}
    >
      <ScanSearch className="size-8 text-muted-foreground" />
      <div className="max-w-md space-y-1">
        <p className="text-sm font-medium">Photograph a shelf</p>
        <p className="text-xs text-muted-foreground">{children}</p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <Button className="gap-2" onClick={() => cameraRef.current?.click()}>
          <Camera className="size-4" /> Add photos
        </Button>
        {/* Phones send the button above straight to the camera. */}
        <Button
          variant="outline"
          className="hidden gap-2 pointer-coarse:inline-flex"
          onClick={() => libraryRef.current?.click()}
        >
          <ImagePlus className="size-4" /> Choose from library
        </Button>
      </div>
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        aria-label="Shelf photos"
        className="hidden"
        onChange={onInput}
      />
      <input
        ref={libraryRef}
        type="file"
        accept="image/*"
        multiple
        aria-label="Shelf photos from your library"
        className="hidden"
        onChange={onInput}
      />
    </div>
  )
}

/** Seconds since `startedAt`, ticking. */
function useElapsed(startedAt: number | null): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (startedAt == null) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [startedAt])
  return startedAt == null
    ? 0
    : Math.max(0, Math.floor((now - startedAt) / 1000))
}

const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`

function PhotoList({ photos }: { photos: ReadonlyArray<ShelfPhoto> }) {
  const readingIndex = photos.findIndex(
    (photo) => photo.state.status === "reading"
  )
  const reading = readingIndex >= 0 ? photos[readingIndex].state : null
  const elapsed = useElapsed(
    reading?.status === "reading" ? reading.startedAt : null
  )
  const finished = photos.filter(
    (photo) => photo.state.status === "read" || photo.state.status === "failed"
  ).length
  const failed = photos.filter(
    (photo) => photo.state.status === "failed"
  ).length
  const preparing = photos.some((photo) => photo.state.status === "preparing")

  let progress: string
  if (readingIndex >= 0) {
    progress = `Reading photo ${readingIndex + 1} of ${photos.length}…`
  } else if (finished < photos.length) {
    progress = preparing ? "Preparing photos…" : "Waiting to read photos…"
  } else {
    progress =
      `Read ${finished - failed} of ${photos.length} photo${photos.length === 1 ? "" : "s"}` +
      (failed > 0 ? ` · ${failed} couldn't be read` : "")
  }

  return (
    <section aria-labelledby="shelf-photos-heading" className="space-y-3">
      <h2
        id="shelf-photos-heading"
        className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase"
      >
        Photos
      </h2>
      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-3 text-sm">
          <p role="status" className="flex items-center gap-2">
            {finished < photos.length && (
              <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
            )}
            {progress}
          </p>
          {reading && (
            <span
              aria-hidden
              className="font-mono text-xs text-muted-foreground tabular-nums"
            >
              {clock(elapsed)}
            </span>
          )}
        </div>
        <Progress
          value={Math.round((finished / photos.length) * 100)}
          aria-label="Photos read"
        />
        {reading && (
          <p className="text-xs text-muted-foreground">
            Each photo takes up to a minute or so to read. You can add the
            missing discs already found meanwhile — reading carries on.
          </p>
        )}
      </div>
      <ul className="grid gap-2 sm:grid-cols-2">
        {photos.map((photo, index) => (
          <PhotoRow key={photo.id} photo={photo} number={index + 1} />
        ))}
      </ul>
    </section>
  )
}

function PhotoRow({ photo, number }: { photo: ShelfPhoto; number: number }) {
  const { state } = photo
  return (
    <li className="flex items-start gap-3 rounded-lg border bg-card p-2">
      <div className="relative aspect-4/3 w-20 shrink-0 overflow-hidden rounded-md bg-secondary">
        {photo.thumbnail && (
          <img
            src={photo.thumbnail}
            alt=""
            className="absolute inset-0 size-full object-cover"
          />
        )}
        {(state.status === "preparing" ||
          state.status === "queued" ||
          state.status === "reading") && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40">
            {state.status !== "queued" && (
              <Loader2 className="size-5 animate-spin text-white" />
            )}
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1 space-y-1 py-0.5">
        <p className="truncate text-xs font-medium">
          Photo {number}
          <span className="font-normal text-muted-foreground">
            {" "}
            · {photo.name}
          </span>
        </p>
        {state.status === "read" && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CircleCheck className="size-3.5 text-lb-green" />
            {state.spines.length === 0
              ? "No spines found"
              : `${state.spines.length} spine${state.spines.length === 1 ? "" : "s"} read`}
          </p>
        )}
        {state.status === "failed" && (
          <>
            <p className="flex items-start gap-1.5 text-xs text-destructive">
              <TriangleAlert className="mt-px size-3.5 shrink-0" />
              {state.error}
            </p>
            {state.retryable && (
              <Button
                size="xs"
                variant="outline"
                onClick={() => retryShelfPhoto(photo.id)}
              >
                Try again
              </Button>
            )}
          </>
        )}
        {state.status !== "read" && state.status !== "failed" && (
          <p className="text-xs text-muted-foreground">
            {state.status === "preparing"
              ? "Preparing…"
              : state.status === "queued"
                ? "Waiting"
                : "Reading…"}
          </p>
        )}
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Remove photo ${number}`}
        onClick={() => removeShelfPhoto(photo.id)}
      >
        <X className="size-4" />
      </Button>
    </li>
  )
}

function Results({
  spines,
  sections,
}: {
  spines: ReadonlyArray<ShelfSpine>
  sections: ShelfCheckSections
}) {
  const { missing, otherFormat, owned } = sections
  if (spines.length === 0) {
    return (
      <p className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
        No disc spines found yet — try closer, straight-on photos in good light.
      </p>
    )
  }
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        {spines.length} spine{spines.length === 1 ? "" : "s"} read:{" "}
        <span className="text-foreground">{missing.length} not catalogued</span>
        , {otherFormat.length} in another format, {owned.length} already
        catalogued.
      </p>

      <ResultSection title="Not in your collection" count={missing.length}>
        {missing.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <CircleCheck className="size-4 text-lb-green" />
            Every spine read is already catalogued.
          </p>
        ) : (
          <ul className="space-y-2">
            {missing.map((entry) => (
              <SpineRow
                key={entry.key}
                spine={entry.spine}
                added={entry.added}
              />
            ))}
          </ul>
        )}
      </ResultSection>

      {otherFormat.length > 0 && (
        <ResultSection title="In another format" count={otherFormat.length}>
          <ul className="space-y-2">
            {otherFormat.map((entry) => (
              <SpineRow
                key={entry.key}
                spine={entry.spine}
                added={entry.added}
              />
            ))}
          </ul>
        </ResultSection>
      )}

      {owned.length > 0 && <OwnedSection entries={owned} />}
    </div>
  )
}

function OwnedSection({ entries }: { entries: Array<ShelfCheckEntry> }) {
  const [open, setOpen] = useState(false)
  const listId = useId()
  return (
    <section className="space-y-3">
      <h2>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 rounded-sm text-sm font-bold tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronDown
            className={cn("size-4 transition-transform", !open && "-rotate-90")}
          />
          Already catalogued
          <span className="text-xs font-normal text-muted-foreground tabular-nums">
            {entries.length}
          </span>
        </button>
      </h2>
      <ul id={listId} hidden={!open} className="grid gap-2 sm:grid-cols-2">
        {entries.map(({ key, spine }) => (
          <li key={key}>
            {spine.film ? (
              <Link
                to="/films/$filmId"
                params={{ filmId: spine.film.id }}
                className="flex items-center gap-3 rounded-lg border bg-card p-2 transition-colors outline-none hover:border-lb-green focus-visible:ring-2 focus-visible:ring-ring"
              >
                <SmallCover coverUrl={spine.film.coverUrl} />
                <span className="min-w-0 flex-1 truncate text-sm">
                  {filmLabel(spine.film)} · {spine.film.format}
                </span>
              </Link>
            ) : (
              <p className="rounded-lg border bg-card p-2 text-sm">
                {spine.title}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
