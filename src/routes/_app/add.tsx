import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router"
import { Loader2, ScanSearch } from "lucide-react"
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
import { Button } from "@/components/ui/button"
import { filmFormatSchema } from "@/lib/film-formats"
import {
  blurayToValues,
  cexToValues,
  withScannedBarcode,
} from "@/lib/import-mappers"
import { filmsQuery } from "@/lib/queries"
import { importBlurayUrlFn } from "@/server/bluray"
import { importCexFn } from "@/server/cex"
import { createFilmFn } from "@/server/films"

const searchSchema = z.object({
  title: z.string().optional(),
  year: z.string().optional(),
  format: filmFormatSchema.optional().catch(undefined),
  coverUrl: z.string().optional(),
  barcode: z.string().optional(),
  /** Blu-ray.com product URL to auto-import on load (from the scanner). */
  importUrl: z.string().optional(),
  /** CEX barcode to auto-import on load (obscure-DVD fallback). */
  cexId: z.string().optional(),
  /** Open the camera scanner straight away (header Scan shortcut). */
  scan: z.string().optional(),
  /** Seed the Blu-ray.com search box, so its autocomplete runs (Shelf check). */
  importQuery: z.string().optional(),
  /** Go back to the Shelf check after adding, to carry on down its list. */
  from: z.enum(["shelf-check"]).optional().catch(undefined),
  /** …to the order check of this shelf. */
  checkShelf: z.string().optional(),
})

export const Route = createFileRoute("/_app/add")({
  validateSearch: searchSchema,
  component: AddFilmPage,
})

function AddFilmPage() {
  const prefill = Route.useSearch()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: films } = useQuery(filmsQuery)
  const [imported, setImported] = useState<FilmFormValues | null>(null)
  const [formKey, setFormKey] = useState(0)

  const create = useMutation({
    mutationFn: createFilmFn,
    onSuccess: async (film) => {
      await queryClient.invalidateQueries({ queryKey: ["films"] })
      toast.success(`“${film.title}” added to your collection`)
      if (prefill.from === "shelf-check") {
        await navigate({
          to: "/shelf-check",
          search: { shelf: prefill.checkShelf },
          replace: true,
        })
        return
      }
      await navigate({ to: "/films/$filmId", params: { filmId: film.id } })
    },
    onError: () => toast.error("Could not add the film — check the fields"),
  })

  const applyImport = (values: FilmFormValues) => {
    setImported(withScannedBarcode(values, prefill.barcode))
    setFormKey((k) => k + 1)
  }

  // Auto-import when the scanner hands us a product URL.
  const autoImport = useMutation({
    mutationFn: (url: string) => importBlurayUrlFn({ data: { url } }),
    onSuccess: (result) => {
      if (result.success) {
        applyImport(blurayToValues(result.data))
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
        applyImport(cexToValues(result.data))
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
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Add a film</h1>
          <p className="text-sm text-muted-foreground">
            Search Blu-ray.com, paste a product link, or scan the disc's barcode
            to import the full details — or fill the form in by hand.
          </p>
        </div>
        <Button
          nativeButton={false}
          variant="outline"
          className="gap-2"
          render={<Link to="/shelf-check" />}
        >
          <ScanSearch className="size-4" /> Shelf check
        </Button>
      </div>
      <BlurayImportBox
        onImport={applyImport}
        autoOpenScanner={prefill.scan != null}
        initialQuery={prefill.importQuery}
        collection={films}
      />
      {(autoImport.isPending || cexImport.isPending) && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
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
            format: prefill.format ?? emptyFilmValues.format,
            coverUrl: prefill.coverUrl ?? "",
            barcode: prefill.barcode ?? "",
          }
        }
        submitLabel="Add to collection"
        sameDiscSubmitLabel="Add another copy"
        collection={films}
        pending={create.isPending}
        onSubmit={(values) => create.mutate({ data: valuesToInput(values) })}
      />
    </div>
  )
}
