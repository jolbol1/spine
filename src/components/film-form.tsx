import { useMutation } from "@tanstack/react-query"
import { ImageIcon, Loader2, Search, Sparkles } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { PosterFrame } from "@/components/film-card"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import type { Film } from "@/db/schema"
import { FORMATS, HDR_TYPES, PACKAGE_TYPES, REGIONS } from "@/lib/film-helpers"
import { searchBlurayFn } from "@/server/bluray"
import type { BlurayResult } from "@/server/bluray"
import { lookupSpineFn } from "@/server/criterion"

export interface FilmFormValues {
  title: string
  director: string
  year: string
  format: string
  audio: string
  hdr: string
  region: string
  label: string
  edition: string
  packageType: string
  spineNumber: string
  runtimeMinutes: string
  discCount: string
  barcode: string
  coverUrl: string
  notes: string
  pricePaid: string
  tmdbId: string
}

export const emptyFilmValues: FilmFormValues = {
  title: "",
  director: "",
  year: "",
  format: "Blu-ray",
  audio: "",
  hdr: "",
  region: "",
  label: "",
  edition: "",
  packageType: "",
  spineNumber: "",
  runtimeMinutes: "",
  discCount: "1",
  barcode: "",
  coverUrl: "",
  notes: "",
  pricePaid: "",
  tmdbId: "",
}

export function filmToValues(film: Film): FilmFormValues {
  return {
    title: film.title,
    director: film.director ?? "",
    year: film.year?.toString() ?? "",
    format: film.format,
    audio: film.audio ?? "",
    hdr: film.hdr ?? "",
    region: film.region ?? "",
    label: film.label ?? "",
    edition: film.edition ?? "",
    packageType: film.packageType ?? "",
    spineNumber: film.spineNumber?.toString() ?? "",
    runtimeMinutes: film.runtimeMinutes?.toString() ?? "",
    discCount: film.discCount.toString(),
    barcode: film.barcode ?? "",
    coverUrl: film.coverUrl ?? "",
    notes: film.notes ?? "",
    pricePaid: film.pricePaid ?? "",
    tmdbId:
      film.tmdbId != null
        ? `${film.tmdbMediaType ?? "movie"}/${film.tmdbId}`
        : "",
  }
}

const toInt = (s: string) => {
  const n = Number.parseInt(s, 10)
  return Number.isFinite(n) ? n : null
}

const toPrice = (s: string) => {
  const n = Number.parseFloat(s.replace(/[£$€,\s]/g, ""))
  return Number.isFinite(n) && n >= 0 ? n : null
}

/**
 * Parse a manual TMDB reference. Movie and TV ids collide on TMDB, so the
 * field accepts "tv/60573", "movie/603", a full themoviedb.org URL, or a
 * bare id (movie assumed first server-side).
 */
function parseTmdbRef(s: string): {
  tmdbId: number | null
  tmdbMediaType: "movie" | "tv" | null
} {
  const trimmed = s.trim()
  const typed = /(?:themoviedb\.org\/)?\b(movie|tv)\/(\d+)/.exec(trimmed)
  if (typed) {
    return {
      tmdbId: Number(typed[2]),
      tmdbMediaType: typed[1] as "movie" | "tv",
    }
  }
  const id = toInt(trimmed)
  return { tmdbId: id != null && id > 0 ? id : null, tmdbMediaType: null }
}

/** Convert form values to the server function input shape. */
export function valuesToInput(v: FilmFormValues) {
  return {
    title: v.title,
    director: v.director || null,
    year: toInt(v.year),
    format: v.format as "4K UHD" | "Blu-ray" | "DVD",
    audio: v.audio || null,
    hdr: v.hdr === "SDR" ? null : v.hdr || null,
    region: v.region || null,
    label: v.label || null,
    edition: v.edition || null,
    packageType: v.packageType || null,
    spineNumber: toInt(v.spineNumber),
    runtimeMinutes: toInt(v.runtimeMinutes),
    discCount: toInt(v.discCount) ?? 1,
    barcode: v.barcode || null,
    coverUrl: v.coverUrl || null,
    notes: v.notes || null,
    pricePaid: toPrice(v.pricePaid),
    ...parseTmdbRef(v.tmdbId),
  }
}

export function FilmForm({
  initial,
  submitLabel,
  pending,
  onSubmit,
}: {
  initial: FilmFormValues
  submitLabel: string
  pending: boolean
  onSubmit: (values: FilmFormValues) => void
}) {
  const [values, setValues] = useState(initial)

  const spineLookup = useMutation({
    mutationFn: lookupSpineFn,
    onSuccess: (result) => {
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      if (result.spine == null) {
        toast.info(
          `No Criterion spine found for “${values.title.trim()}” — is it in the Collection?`
        )
        return
      }
      setValues((prev) => ({ ...prev, spineNumber: String(result.spine) }))
      toast.success(`Spine #${result.spine}`)
    },
    onError: () => toast.error("Spine lookup failed"),
  })

  const set = (key: keyof FilmFormValues) => (value: string) =>
    setValues((prev) => ({ ...prev, [key]: value }))
  const input =
    (key: keyof FilmFormValues) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      set(key)(e.target.value)

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (!values.title.trim()) {
          toast.error("A title is required")
          return
        }
        onSubmit(values)
      }}
      className="grid gap-8 md:grid-cols-[220px_1fr]"
    >
      {/* Cover column */}
      <div className="space-y-3">
        <PosterFrame
          coverUrl={values.coverUrl || null}
          title={values.title || "No cover"}
        />
        <CoverSearchDialog
          defaultQuery={[values.title, values.year].filter(Boolean).join(" ")}
          onPick={(result) => {
            setValues((prev) => ({
              ...prev,
              coverUrl: result.coverUrl,
              title: prev.title || cleanBlurayTitle(result.title),
              year: prev.year || (result.year?.toString() ?? ""),
            }))
          }}
        />
        <Field>
          <FieldLabel htmlFor="coverUrl">Cover URL</FieldLabel>
          <Input
            id="coverUrl"
            placeholder="https://…"
            value={values.coverUrl}
            onChange={input("coverUrl")}
          />
        </Field>
      </div>

      {/* Metadata column */}
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field className="sm:col-span-2">
            <FieldLabel htmlFor="title">Title *</FieldLabel>
            <Input
              id="title"
              required
              value={values.title}
              onChange={input("title")}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="director">Director</FieldLabel>
            <Input
              id="director"
              value={values.director}
              onChange={input("director")}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="year">Year</FieldLabel>
            <Input
              id="year"
              type="number"
              min={1878}
              max={2100}
              value={values.year}
              onChange={input("year")}
            />
          </Field>
          <Field>
            <FieldLabel>Format</FieldLabel>
            <Select
              value={values.format}
              onValueChange={(v) => set("format")(v as string)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FORMATS.map((f) => (
                  <SelectItem key={f} value={f}>
                    {f}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel>HDR</FieldLabel>
            <Select
              value={values.hdr || "SDR"}
              onValueChange={(v) => set("hdr")(v as string)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {HDR_TYPES.map((h) => (
                  <SelectItem key={h} value={h}>
                    {h}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="audio">Audio</FieldLabel>
            <Input
              id="audio"
              placeholder="e.g. DTS-HD MA 5.1"
              value={values.audio}
              onChange={input("audio")}
            />
          </Field>
          <Field>
            <FieldLabel>Region</FieldLabel>
            <Select
              value={values.region || null}
              onValueChange={(v) => set("region")(v ?? "")}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select region" />
              </SelectTrigger>
              <SelectContent>
                {REGIONS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="label">Publisher / Label</FieldLabel>
            <Input
              id="label"
              placeholder="e.g. Criterion, Arrow"
              value={values.label}
              onChange={input("label")}
            />
          </Field>
          <Field>
            <FieldLabel>Package type</FieldLabel>
            <Select
              value={values.packageType || null}
              onValueChange={(v) => set("packageType")(v ?? "")}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select type" />
              </SelectTrigger>
              <SelectContent>
                {PACKAGE_TYPES.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="edition">Edition</FieldLabel>
            <Input
              id="edition"
              placeholder="e.g. Limited Edition"
              value={values.edition}
              onChange={input("edition")}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="spineNumber">Criterion spine #</FieldLabel>
            <div className="flex gap-2">
              <Input
                id="spineNumber"
                type="number"
                min={1}
                value={values.spineNumber}
                onChange={input("spineNumber")}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Look up spine number on criterion.com"
                title="Look up spine number"
                disabled={!values.title.trim() || spineLookup.isPending}
                onClick={() =>
                  spineLookup.mutate({
                    data: {
                      title: values.title.trim(),
                      year: values.year ? Number(values.year) : null,
                    },
                  })
                }
              >
                {spineLookup.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Sparkles className="size-4" />
                )}
              </Button>
            </div>
          </Field>
          <Field>
            <FieldLabel htmlFor="runtimeMinutes">Runtime (minutes)</FieldLabel>
            <Input
              id="runtimeMinutes"
              type="number"
              min={1}
              value={values.runtimeMinutes}
              onChange={input("runtimeMinutes")}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="discCount">Disc count</FieldLabel>
            <Input
              id="discCount"
              type="number"
              min={1}
              value={values.discCount}
              onChange={input("discCount")}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="barcode">Barcode (UPC/EAN)</FieldLabel>
            <Input
              id="barcode"
              inputMode="numeric"
              value={values.barcode}
              onChange={input("barcode")}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="pricePaid">Price paid</FieldLabel>
            <Input
              id="pricePaid"
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              placeholder="e.g. 14.99"
              value={values.pricePaid}
              onChange={input("pricePaid")}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="tmdbId">TMDB ID or URL</FieldLabel>
            <Input
              id="tmdbId"
              placeholder="e.g. tv/60573 — fixes a wrong match"
              value={values.tmdbId}
              onChange={input("tmdbId")}
            />
          </Field>
        </div>
        <Field>
          <FieldLabel htmlFor="notes">Notes</FieldLabel>
          <Textarea
            id="notes"
            rows={3}
            value={values.notes}
            onChange={input("notes")}
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="submit" disabled={pending}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            {submitLabel}
          </Button>
        </div>
      </div>
    </form>
  )
}

/** Strip parenthetical junk blu-ray.com appends, e.g. alt titles + year. */
export function cleanBlurayTitle(title: string): string {
  return title.replace(/\s*\([^)]*\)\s*/g, " ").trim()
}

export function CoverSearchDialog({
  defaultQuery,
  onPick,
  triggerLabel = "Find cover on Blu-ray.com",
}: {
  defaultQuery: string
  onPick: (result: BlurayResult) => void
  triggerLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState(defaultQuery)
  const search = useMutation({
    mutationFn: (q: string) => searchBlurayFn({ data: { query: q } }),
  })

  function runSearch() {
    const q = query.trim()
    if (!q) return
    search.mutate(q)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) {
          setQuery(defaultQuery)
          if (defaultQuery.trim()) search.mutate(defaultQuery.trim())
        }
      }}
    >
      <DialogTrigger
        render={
          <Button type="button" variant="outline" className="w-full gap-2" />
        }
      >
        <ImageIcon className="size-4" /> {triggerLabel}
      </DialogTrigger>
      <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Search Blu-ray.com</DialogTitle>
        </DialogHeader>
        <div className="flex gap-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Title or barcode…"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                runSearch()
              }
            }}
          />
          <Button type="button" onClick={runSearch} disabled={search.isPending}>
            {search.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Search className="size-4" />
            )}
            Search
          </Button>
        </div>
        {search.data && search.data.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No releases found. Try a different title or the barcode.
          </p>
        )}
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
          {search.data?.map((result) => (
            <button
              key={result.url}
              type="button"
              className="group rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => {
                onPick(result)
                setOpen(false)
              }}
            >
              <div className="relative aspect-2/3 overflow-hidden rounded-md bg-secondary ring-1 ring-transparent transition group-hover:ring-2 group-hover:ring-lb-green">
                <img
                  src={result.coverUrl}
                  alt={result.title}
                  loading="lazy"
                  className="absolute inset-0 size-full object-cover"
                />
                {result.countryFlag && (
                  <img
                    src={result.countryFlag}
                    alt=""
                    className="absolute top-1 right-1 h-3 rounded-[2px]"
                  />
                )}
              </div>
              <p className="mt-1 line-clamp-2 text-xs leading-tight">
                {result.title}
              </p>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
