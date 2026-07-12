import { useMutation, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { Loader2 } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { z } from "zod"
import { BlurayImportBox } from "@/components/bluray-import"
import {
  FilmForm,
  emptyFilmValues,
  valuesToInput,
} from "@/components/film-form"
import type { FilmFormValues } from "@/components/film-form"
import { importBlurayUrlFn } from "@/server/bluray"
import type { BlurayImport } from "@/server/bluray"
import { importCexFn } from "@/server/cex"
import type { CexImport } from "@/server/cex"
import { createFilmFn } from "@/server/films"

const searchSchema = z.object({
  title: z.string().optional(),
  year: z.string().optional(),
  coverUrl: z.string().optional(),
  barcode: z.string().optional(),
  /** Blu-ray.com product URL to auto-import on load (from the scanner). */
  importUrl: z.string().optional(),
  /** CEX barcode to auto-import on load (obscure-DVD fallback). */
  cexId: z.string().optional(),
})

export const Route = createFileRoute("/_app/add")({
  validateSearch: searchSchema,
  component: AddFilmPage,
})

/** Map the free-text HDR line from Blu-ray.com onto the form's options. */
function normalizeHdr(hdr: string | null): string {
  if (!hdr) return ""
  if (hdr.includes("Dolby Vision")) return "Dolby Vision"
  if (hdr.includes("HDR10+")) return "HDR10+"
  if (hdr.includes("HDR10")) return "HDR10"
  return ""
}

/** CEX disc details → form values; catalogue extras land in the notes. */
function cexToValues(data: CexImport): FilmFormValues {
  const notes = [
    data.bbfcRating && `BBFC: ${data.bbfcRating}`,
    data.genres.length > 0 && `Genre: ${data.genres.join(", ")}`,
    data.publisher && `Publisher: ${data.publisher}`,
    data.supplier && `Supplier: ${data.supplier}`,
  ]
    .filter(Boolean)
    .join("\n")
  return {
    ...emptyFilmValues,
    title: data.title,
    year: data.year?.toString() ?? "",
    format: data.format,
    label: data.label ?? "",
    runtimeMinutes: data.runtimeMinutes?.toString() ?? "",
    coverUrl: data.coverUrl ?? "",
    barcode: data.barcode,
    notes,
  }
}

function importToValues(data: BlurayImport): FilmFormValues {
  return {
    ...emptyFilmValues,
    title: data.title,
    director: data.director ?? "",
    year: data.year?.toString() ?? "",
    format: data.format,
    audio: data.audio ?? "",
    hdr: normalizeHdr(data.hdr),
    region: data.region?.split(",")[0]?.trim() ?? "",
    label: data.label ?? "",
    spineNumber: data.spineNumber?.toString() ?? "",
    runtimeMinutes: data.runtimeMinutes?.toString() ?? "",
    discCount: data.discCount.toString(),
    coverUrl: data.coverUrl ?? "",
  }
}

function AddFilmPage() {
  const prefill = Route.useSearch()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [imported, setImported] = useState<FilmFormValues | null>(null)
  const [formKey, setFormKey] = useState(0)

  const create = useMutation({
    mutationFn: createFilmFn,
    onSuccess: async (film) => {
      await queryClient.invalidateQueries({ queryKey: ["films"] })
      toast.success(`“${film.title}” added to your collection`)
      await navigate({ to: "/films/$filmId", params: { filmId: film.id } })
    },
    onError: () => toast.error("Could not add the film — check the fields"),
  })

  const applyImport = (data: BlurayImport) => {
    setImported({
      ...importToValues(data),
      barcode: prefill.barcode ?? "",
    })
    setFormKey((k) => k + 1)
  }

  // Auto-import when the scanner hands us a product URL.
  const autoImport = useMutation({
    mutationFn: (url: string) => importBlurayUrlFn({ data: { url } }),
    onSuccess: (result) => {
      if (result.success) {
        applyImport(result.data)
      } else {
        toast.error(result.error)
      }
    },
    onError: () =>
      toast.error("Import failed — the basics from the scan are filled in"),
  })
  // Auto-import CEX details when the scanner found the disc there instead.
  const cexImport = useMutation({
    mutationFn: (cexId: string) => importCexFn({ data: { barcode: cexId } }),
    onSuccess: (result) => {
      if (result.success) {
        setImported(cexToValues(result.data))
        setFormKey((k) => k + 1)
      } else {
        toast.error(result.error)
      }
    },
    onError: () => toast.error("CEX import failed"),
  })

  const autoImportStarted = useRef(false)
  useEffect(() => {
    if (autoImportStarted.current) return
    if (prefill.importUrl) {
      autoImportStarted.current = true
      autoImport.mutate(prefill.importUrl)
    } else if (prefill.cexId) {
      autoImportStarted.current = true
      cexImport.mutate(prefill.cexId)
    }
  }, [prefill.importUrl, prefill.cexId, autoImport, cexImport])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Add a film</h1>
        <p className="text-muted-foreground text-sm">
          Search Blu-ray.com or paste a product link to import the full disc
          details — or fill the form in by hand.
        </p>
      </div>
      <BlurayImportBox onImport={applyImport} />
      {(autoImport.isPending || cexImport.isPending) && (
        <p className="text-muted-foreground flex items-center gap-2 text-sm">
          <Loader2 className="size-4 animate-spin" />
          Importing full disc details from{" "}
          {cexImport.isPending ? "CEX" : "Blu-ray.com"}…
        </p>
      )}
      <FilmForm
        key={formKey}
        initial={
          imported ?? {
            ...emptyFilmValues,
            title: prefill.title ?? "",
            year: prefill.year ?? "",
            coverUrl: prefill.coverUrl ?? "",
            barcode: prefill.barcode ?? "",
          }
        }
        submitLabel="Add to collection"
        pending={create.isPending}
        onSubmit={(values) => create.mutate({ data: valuesToInput(values) })}
      />
    </div>
  )
}
