import { useMutation } from "@tanstack/react-query"
import { Link2, Loader2, ScanBarcode, Search } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { BarcodeScanDialog } from "@/components/barcode-scan"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { FilmFormValues } from "@/components/film-form"
import { emptyFilmValues } from "@/components/film-form"
import {
  blurayToValues,
  cexIdFromUrl,
  cexToValues,
  scrapeToValues,
  withScannedBarcode,
} from "@/lib/import-mappers"
import { searchBlurayFn, importBlurayUrlFn } from "@/server/bluray"
import type { BlurayResult } from "@/server/bluray"
import { importCexFn } from "@/server/cex"
import type { TmdbTitleMatch } from "@/server/tmdb"
import { searchWebBarcodeFn } from "@/server/websearch"
import { scrapeWishlistUrlFn } from "@/server/wishlist"
import { cn } from "@/lib/utils"

function looksLikeUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim()) || value.includes("blu-ray.com/")
}

/**
 * Import a product URL from whichever source it belongs to:
 * Blu-ray.com pages get the full disc parser, CEX links use their box
 * API, and any other supported retailer goes through the wishlist
 * scraper (title/price/cover — TMDB fills the rest on add).
 */
async function importFromUrl(
  raw: string
): Promise<
  | { ok: true; values: FilmFormValues; source: string }
  | { ok: false; error: string }
> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { ok: false, error: "That's not a valid URL." }
  }
  const host = url.hostname.replace(/^www\./, "")

  if (host.endsWith("blu-ray.com")) {
    const result = await importBlurayUrlFn({ data: { url: raw } })
    return result.success
      ? { ok: true, values: blurayToValues(result.data), source: "Blu-ray.com" }
      : { ok: false, error: result.error }
  }

  const cexId = cexIdFromUrl(url)
  if (cexId) {
    const result = await importCexFn({ data: { barcode: cexId } })
    return result.success
      ? { ok: true, values: cexToValues(result.data), source: "CEX" }
      : { ok: false, error: result.error }
  }

  const result = await scrapeWishlistUrlFn({ data: { url: raw } })
  return result.success
    ? {
        ok: true,
        values: scrapeToValues(result.data),
        source: result.data.retailer,
      }
    : { ok: false, error: result.error }
}

/** One autocomplete entry — a web-search TMDB match or a Blu-ray.com hit. */
type ImportOption =
  | { kind: "web"; match: TmdbTitleMatch }
  | { kind: "bluray"; result: BlurayResult }

const LISTBOX_ID = "bluray-import-listbox"
const optionId = (index: number) => `bluray-import-option-${index}`

/**
 * One box, two behaviours: type a title to autocomplete against
 * Blu-ray.com, or paste a product link from Blu-ray.com, CEX, or any
 * supported retailer (HMV, Zavvi, Arrow, Criterion, …).
 */
export function BlurayImportBox({
  onImport,
  autoOpenScanner = false,
}: {
  onImport: (values: FilmFormValues) => void
  /** Open the camera scanner immediately (e.g. from the header Scan link). */
  autoOpenScanner?: boolean
}) {
  const [value, setValue] = useState("")
  const [results, setResults] = useState<BlurayResult[]>([])
  const [webMatches, setWebMatches] = useState<TmdbTitleMatch[]>([])
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [searching, setSearching] = useState(false)
  const [scannerOpen, setScannerOpen] = useState(autoOpenScanner)
  const [scannedCode, setScannedCode] = useState<string | null>(null)
  const [scanStage, setScanStage] = useState<string | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const requestSeq = useRef(0)
  const scanAbortRef = useRef<AbortController | null>(null)

  const importUrl = useMutation({
    mutationFn: importFromUrl,
    onSuccess: (result) => {
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      setOpen(false)
      setValue("")
      setResults([])
      setWebMatches([])
      setActiveIndex(-1)
      onImport(withScannedBarcode(result.values, scannedCode))
      toast.success(`Imported “${result.values.title}” from ${result.source}`)
    },
    onError: () => toast.error("Import failed"),
  })

  // Scanned-barcode chain: Blu-ray.com → CEX → web search → manual.
  // A re-scan aborts the in-flight chain so a slow lookup for a misread
  // barcode can never land after — and override — the newer scan.
  const scanLookup = useMutation({
    mutationFn: async ({
      code,
      signal,
    }: {
      code: string
      signal: AbortSignal
    }) => {
      setScanStage("Searching Blu-ray.com…")
      const found = await searchBlurayFn({ data: { query: code }, signal })
      if (found.length > 0) return { kind: "bluray" as const, found }

      signal.throwIfAborted()
      setScanStage("Not on Blu-ray.com — trying CEX…")
      const cex = await importCexFn({ data: { barcode: code }, signal })
      if (cex.success) return { kind: "cex" as const, data: cex.data }

      signal.throwIfAborted()
      setScanStage("Not on CEX either — searching the web…")
      const web = await searchWebBarcodeFn({ data: { barcode: code }, signal })
      if (web.success && web.matches.length > 0) {
        return { kind: "web" as const, matches: web.matches }
      }
      return { kind: "miss" as const }
    },
    onSuccess: (result, { code, signal }) => {
      // A newer scan superseded this one while it was resolving.
      if (signal.aborted) return
      setScanStage(null)
      switch (result.kind) {
        case "bluray":
          setResults(result.found)
          setWebMatches([])
          setActiveIndex(-1)
          setOpen(true)
          break
        case "cex":
          onImport(withScannedBarcode(cexToValues(result.data), code))
          toast.success(`Imported “${result.data.title}” from CEX`)
          break
        case "web":
          setWebMatches(result.matches)
          setResults([])
          setActiveIndex(-1)
          setOpen(true)
          break
        case "miss":
          onImport({ ...emptyFilmValues, barcode: code })
          toast.info(
            `No match for ${code} anywhere — barcode filled in, add the rest by hand.`
          )
      }
    },
    onError: (_error, { signal }) => {
      // Aborted by a re-scan — the newer chain owns the UI now.
      if (signal.aborted) return
      setScanStage(null)
      toast.error("Barcode lookup failed")
    },
  })

  const onScanned = (code: string) => {
    scanAbortRef.current?.abort()
    const controller = new AbortController()
    scanAbortRef.current = controller
    setScannedCode(code)
    setValue(code)
    setResults([])
    setWebMatches([])
    setActiveIndex(-1)
    scanLookup.mutate({ code, signal: controller.signal })
  }

  const isUrl = looksLikeUrl(value)

  // Web matches first, then Blu-ray.com hits — one keyboard-walkable list.
  const options: ImportOption[] = isUrl
    ? []
    : [
        ...webMatches.map((match) => ({ kind: "web" as const, match })),
        ...results.map((result) => ({ kind: "bluray" as const, result })),
      ]
  const listOpen = open && options.length > 0

  useEffect(() => {
    if (activeIndex < 0) return
    document
      .getElementById(optionId(activeIndex))
      ?.scrollIntoView({ block: "nearest" })
  }, [activeIndex])

  const selectOption = (option: ImportOption) => {
    if (option.kind === "web") {
      setOpen(false)
      setWebMatches([])
      setActiveIndex(-1)
      onImport({
        ...emptyFilmValues,
        title: option.match.title,
        year: option.match.year?.toString() ?? "",
        coverUrl: option.match.posterUrl ?? "",
        barcode: scannedCode ?? "",
        tmdbId: `${option.match.mediaType}/${option.match.tmdbId}`,
      })
    } else {
      if (importUrl.isPending) return
      importUrl.mutate(option.result.url)
    }
  }

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (isUrl) return
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault()
      if (options.length === 0) return
      if (!open) {
        setOpen(true)
        return
      }
      setActiveIndex((prev) => {
        const delta = e.key === "ArrowDown" ? 1 : -1
        return (prev + delta + options.length) % options.length
      })
    } else if (e.key === "Enter") {
      if (listOpen && activeIndex >= 0 && activeIndex < options.length) {
        e.preventDefault()
        selectOption(options[activeIndex])
      }
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault()
        setOpen(false)
      }
    }
  }

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const query = value.trim()
    if (isUrl || query.length < 2) {
      setResults([])
      setActiveIndex(-1)
      setSearching(false)
      return
    }
    // A just-scanned barcode runs its own lookup chain — don't double-search.
    if (query === scannedCode) {
      setSearching(false)
      return
    }
    setSearching(true)
    const seq = ++requestSeq.current
    debounceRef.current = setTimeout(async () => {
      try {
        const found = await searchBlurayFn({ data: { query } })
        if (seq === requestSeq.current) {
          setResults(found)
          setActiveIndex(-1)
          setOpen(true)
        }
      } catch {
        // Search hiccup — keep the previous results.
      } finally {
        if (seq === requestSeq.current) setSearching(false)
      }
    }, 400)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [value, isUrl, scannedCode])

  // Close the dropdown on outside click.
  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("pointerdown", onPointerDown)
    return () => document.removeEventListener("pointerdown", onPointerDown)
  }, [])

  return (
    <div ref={boxRef} className="relative">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (isUrl && value.trim()) importUrl.mutate(value.trim())
        }}
      >
        <div className="relative flex-1">
          {isUrl ? (
            <Link2 className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          ) : (
            <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          )}
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onFocus={() => options.length > 0 && setOpen(true)}
            onKeyDown={onInputKeyDown}
            placeholder="Search Blu-ray.com, or paste a link (Blu-ray.com, CEX, HMV, Arrow…)"
            className="pl-8"
            aria-label="Search Blu-ray.com or paste a product link"
            role="combobox"
            aria-expanded={listOpen}
            aria-controls={listOpen ? LISTBOX_ID : undefined}
            aria-autocomplete="list"
            aria-activedescendant={
              listOpen && activeIndex >= 0 ? optionId(activeIndex) : undefined
            }
          />
          {(searching || importUrl.isPending || scanLookup.isPending) && (
            <Loader2 className="absolute top-1/2 right-2.5 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
          )}
        </div>
        <Button
          type="button"
          variant="outline"
          className="gap-2"
          aria-label="Scan a barcode with the camera"
          onClick={() => setScannerOpen(true)}
        >
          <ScanBarcode className="size-4" />
          <span className="hidden sm:inline">Scan</span>
        </Button>
        {isUrl && (
          <Button type="submit" disabled={importUrl.isPending}>
            Import
          </Button>
        )}
      </form>

      {scanStage && (
        <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          {scannedCode && (
            <span className="font-mono text-foreground">{scannedCode}</span>
          )}
          {scanStage}
        </p>
      )}

      <BarcodeScanDialog
        open={scannerOpen}
        onOpenChange={setScannerOpen}
        onDetected={onScanned}
      />

      {listOpen && (
        <ul
          id={LISTBOX_ID}
          role="listbox"
          aria-label="Import matches"
          className="absolute z-30 mt-1 max-h-96 w-full overflow-y-auto rounded-md border bg-popover shadow-xl"
        >
          {webMatches.length > 0 && (
            <li
              role="presentation"
              className="px-3 pt-2 pb-1 text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase"
            >
              Best matches from a web search — check the year
            </li>
          )}
          {options.map((option, index) => (
            <li
              key={
                option.kind === "web"
                  ? `${option.match.mediaType}-${option.match.tmdbId}`
                  : option.result.url
              }
              id={optionId(index)}
              role="option"
              aria-selected={index === activeIndex}
              aria-disabled={
                (option.kind === "bluray" && importUrl.isPending) || undefined
              }
              className={cn(
                "flex w-full cursor-pointer items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-accent",
                index === activeIndex && "bg-accent",
                option.kind === "bluray" && importUrl.isPending && "opacity-50"
              )}
              onClick={() => selectOption(option)}
            >
              {option.kind === "web" ? (
                <>
                  {option.match.posterUrl ? (
                    <img
                      src={option.match.posterUrl}
                      alt=""
                      loading="lazy"
                      className="h-14 w-10 shrink-0 rounded-sm bg-secondary object-cover"
                    />
                  ) : (
                    <span className="h-14 w-10 shrink-0 rounded-sm bg-secondary" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">
                      {option.match.title}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {[
                        option.match.year,
                        option.match.mediaType === "tv" ? "TV" : "Movie",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                </>
              ) : (
                <>
                  <img
                    src={option.result.coverUrl.replace(
                      "_front.jpg",
                      "_small.jpg"
                    )}
                    alt=""
                    loading="lazy"
                    className="h-14 w-10 shrink-0 rounded-sm bg-secondary object-cover"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">
                      {option.result.title}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {[option.result.year, option.result.releaseDate]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  {option.result.countryFlag && (
                    <img
                      src={option.result.countryFlag}
                      alt=""
                      className="h-3"
                    />
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
