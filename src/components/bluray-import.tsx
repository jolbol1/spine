import { useMutation } from "@tanstack/react-query"
import { Link2, Loader2, Search } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { searchBlurayFn, importBlurayUrlFn } from "@/server/bluray"
import type { BlurayImport, BlurayResult } from "@/server/bluray"

function looksLikeUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim()) || value.includes("blu-ray.com/")
}

/**
 * One box, two behaviours: type a title to autocomplete against
 * Blu-ray.com, or paste a product link. Either way the pick is imported
 * with full disc metadata.
 */
export function BlurayImportBox({
  onImport,
}: {
  onImport: (data: BlurayImport) => void
}) {
  const [value, setValue] = useState("")
  const [results, setResults] = useState<BlurayResult[]>([])
  const [open, setOpen] = useState(false)
  const [searching, setSearching] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const requestSeq = useRef(0)

  const importUrl = useMutation({
    mutationFn: (url: string) => importBlurayUrlFn({ data: { url } }),
    onSuccess: (result) => {
      if (!result.success) {
        toast.error(result.error)
        return
      }
      setOpen(false)
      setValue("")
      setResults([])
      onImport(result.data)
      toast.success(`Imported “${result.data.title}” from Blu-ray.com`)
    },
    onError: () => toast.error("Import failed"),
  })

  const isUrl = looksLikeUrl(value)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const query = value.trim()
    if (isUrl || query.length < 2) {
      setResults([])
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
  }, [value, isUrl])

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
            <Link2 className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          ) : (
            <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          )}
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onFocus={() => results.length > 0 && setOpen(true)}
            placeholder="Search Blu-ray.com, or paste a product link…"
            className="pl-8"
            aria-label="Search Blu-ray.com or paste a product link"
          />
          {(searching || importUrl.isPending) && (
            <Loader2 className="text-muted-foreground absolute top-1/2 right-2.5 size-4 -translate-y-1/2 animate-spin" />
          )}
        </div>
        {isUrl && (
          <Button type="submit" disabled={importUrl.isPending}>
            Import
          </Button>
        )}
      </form>

      {open && !isUrl && results.length > 0 && (
        <ul className="bg-popover absolute z-30 mt-1 max-h-96 w-full overflow-y-auto rounded-md border shadow-xl">
          {results.map((result) => (
            <li key={result.url}>
              <button
                type="button"
                disabled={importUrl.isPending}
                className="hover:bg-accent flex w-full items-center gap-3 px-3 py-2 text-left transition-colors disabled:opacity-50"
                onClick={() => importUrl.mutate(result.url)}
              >
                <img
                  src={result.coverUrl.replace("_front.jpg", "_small.jpg")}
                  alt=""
                  loading="lazy"
                  className="bg-secondary h-14 w-10 shrink-0 rounded-sm object-cover"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">
                    {result.title}
                  </span>
                  <span className="text-muted-foreground block text-xs">
                    {[result.year, result.releaseDate]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                {result.countryFlag && (
                  <img src={result.countryFlag} alt="" className="h-3" />
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
