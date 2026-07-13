import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router"
import {
  Bookmark,
  Eye,
  LayoutGrid,
  List,
  Loader2,
  Search,
  SlidersHorizontal,
  Star,
  Trash2,
  X,
} from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { z } from "zod"
import { FilmCard, FormatBadge, PosterFrame } from "@/components/film-card"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Field, FieldLabel } from "@/components/ui/field"
import { Switch } from "@/components/ui/switch"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { Film, SavedView } from "@/db/schema"
import {
  FORMATS,
  formatPrice,
  formatRuntime,
  formatUsdCompact,
  isWatched,
  sortLetter,
} from "@/lib/film-helpers"
import { filmsQuery, settingsQuery } from "@/lib/queries"
import { saveViewsFn } from "@/server/settings"
import { cn } from "@/lib/utils"

/**
 * The whole browse state lives in the URL, so a refresh (or a shared
 * link) restores the same search, sort, letter, and filters.
 */
const searchSchema = z.object({
  q: z.string().optional(),
  sort: z
    .enum([
      "title",
      "spine",
      "year",
      "added",
      "budget",
      "boxoffice",
      "roi",
      "rt",
      "rating",
      "tmdbRating",
      "price",
      "runtime",
      "publisher",
      "format",
    ])
    .optional(),
  dir: z.enum(["asc", "desc"]).optional(),
  letter: z.string().max(1).optional(),
  decade: z.string().optional(),
  format: z.string().optional(),
  hdr: z.string().optional(),
  region: z.string().optional(),
  label: z.string().optional(),
  packageType: z.string().optional(),
  edition: z.string().optional(),
  watched: z.string().optional(),
  tmdb: z.string().optional(),
  view: z.enum(["grid", "list"]).optional(),
  overlay: z.string().optional(),
  type: z.enum(["movie", "tv"]).optional(),
})

export const Route = createFileRoute("/_app/")({
  validateSearch: searchSchema,
  loader: ({ context }) => context.queryClient.ensureQueryData(filmsQuery),
  component: CollectionPage,
})

/** Keep only params a saved view can restore — drops junk/stale keys. */
function sanitizeViewParams(
  params: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {}
  const shape: Record<string, z.ZodType | undefined> = searchSchema.shape
  for (const [key, value] of Object.entries(params)) {
    const field = shape[key]
    if (field && field.safeParse(value).success) out[key] = value
  }
  return out
}

const paramsEqual = (
  a: Record<string, string>,
  b: Record<string, string>,
) =>
  JSON.stringify(Object.entries(a).sort()) ===
  JSON.stringify(Object.entries(b).sort())

type SortKey = z.infer<typeof searchSchema>["sort"] & string

/**
 * Metric sorts: films without the metric are hidden, highest value first,
 * and the value is shown in each card's subtext so the order is readable.
 */
const METRIC_SORTS: Partial<
  Record<
    SortKey,
    {
      label: string
      valueOf: (f: Film) => number | null
      display: (f: Film) => string
    }
  >
> = {
  budget: {
    label: "budget",
    valueOf: (f) => f.tmdbDetails?.budget ?? null,
    display: (f) => formatUsdCompact(f.tmdbDetails!.budget!),
  },
  boxoffice: {
    label: "box office",
    valueOf: (f) => f.tmdbDetails?.revenue ?? null,
    display: (f) => formatUsdCompact(f.tmdbDetails!.revenue!),
  },
  roi: {
    label: "return on budget",
    valueOf: (f) =>
      f.tmdbDetails?.budget && f.tmdbDetails.revenue
        ? f.tmdbDetails.revenue / f.tmdbDetails.budget
        : null,
    display: (f) => {
      const multiple = f.tmdbDetails!.revenue! / f.tmdbDetails!.budget!
      return `${multiple >= 10 ? Math.round(multiple) : multiple.toFixed(1)}× budget`
    },
  },
  rt: {
    label: "a Rotten Tomatoes score",
    valueOf: (f) => f.rtCriticsScore,
    display: (f) => `🍅 ${f.rtCriticsScore}%`,
  },
  rating: {
    label: "your Letterboxd rating",
    valueOf: (f) => f.letterboxdRating,
    display: (f) => `★ ${f.letterboxdRating}`,
  },
  tmdbRating: {
    label: "a TMDB rating",
    valueOf: (f) => f.tmdbDetails?.voteAverage ?? null,
    display: (f) => `TMDB ${f.tmdbDetails!.voteAverage!.toFixed(1)}`,
  },
  price: {
    label: "a price",
    valueOf: (f) => (f.pricePaid != null ? Number(f.pricePaid) : null),
    display: (f) => formatPrice(f.pricePaid) ?? "",
  },
  runtime: {
    label: "a runtime",
    valueOf: (f) => f.runtimeMinutes,
    display: (f) => formatRuntime(f.runtimeMinutes!),
  },
}

const SORT_LABELS: Record<SortKey, string> = {
  title: "Alphabetical",
  spine: "Criterion spine #",
  year: "Release year",
  added: "Recently added",
  budget: "Budget",
  boxoffice: "Box office",
  roi: "Return on budget",
  rt: "RT critics score",
  rating: "My rating",
  tmdbRating: "TMDB rating",
  price: "Price paid",
  runtime: "Runtime",
  publisher: "Publisher",
  format: "Format",
}

/** The order each sort produces before a direction toggle reverses it. */
const DEFAULT_DIR: Record<SortKey, "asc" | "desc"> = {
  title: "asc",
  spine: "asc",
  year: "asc",
  added: "desc",
  budget: "desc",
  boxoffice: "desc",
  roi: "desc",
  rt: "desc",
  rating: "desc",
  tmdbRating: "desc",
  price: "desc",
  runtime: "desc",
  publisher: "asc",
  format: "asc",
}

const LETTERS = ["#", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"] as const

const ANY = "any"

/** Advanced-filter keys and how each reads its value off a film. */
const FILTER_DEFS = [
  {
    key: "decade",
    label: "Decade",
    valueOf: (f: Film) =>
      f.year != null ? `${Math.floor(f.year / 10) * 10}s` : null,
  },
  { key: "format", label: "Format", valueOf: (f: Film) => f.format },
  { key: "hdr", label: "HDR", valueOf: (f: Film) => f.hdr ?? "SDR" },
  { key: "region", label: "Region", valueOf: (f: Film) => f.region },
  { key: "label", label: "Publisher", valueOf: (f: Film) => f.label },
  {
    key: "packageType",
    label: "Package",
    valueOf: (f: Film) => f.packageType,
  },
  { key: "edition", label: "Edition", valueOf: (f: Film) => f.edition },
  {
    key: "watched",
    label: "Watched",
    valueOf: (f: Film) => (isWatched(f) ? "Watched" : "Unwatched"),
  },
  {
    key: "tmdb",
    label: "TMDB",
    valueOf: (f: Film) => (f.tmdbId != null ? "Matched" : "No match"),
  },
] as const

type FilterKey = (typeof FILTER_DEFS)[number]["key"]
type Filters = Record<FilterKey, string>

function OverlayChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-sm bg-background/85 px-1.5 py-0.5 text-[10px] font-bold text-foreground tabular-nums backdrop-blur">
      {children}
    </span>
  )
}

const roiMultiple = (f: Film) =>
  f.tmdbDetails?.budget && f.tmdbDetails.revenue
    ? f.tmdbDetails.revenue / f.tmdbDetails.budget
    : null

const formatMultiple = (multiple: number) =>
  `${multiple >= 10 ? Math.round(multiple) : multiple.toFixed(1)}×`

interface OverlayDef {
  key: string
  label: string
  /** Column width class in list view. */
  colClass: string
  /** The sort applied when this value's column header is clicked. */
  sortKey: SortKey
  /** Plain-text value — list-view cell, and the default grid chip. */
  text: (f: Film) => string | null
  /** Grid-chip override for values that want richer markup. */
  render?: (f: Film) => React.ReactNode
}

/**
 * The "Poster info" picker — chips pinned to each poster in grid view,
 * value columns in list view.
 */
const OVERLAY_DEFS: OverlayDef[] = [
  {
    key: "rt",
    sortKey: "rt",
    label: "RT scores",
    colClass: "w-28",
    text: (f) =>
      [
        f.rtCriticsScore != null ? `🍅 ${f.rtCriticsScore}%` : null,
        f.rtAudienceScore != null ? `🍿 ${f.rtAudienceScore}%` : null,
      ]
        .filter(Boolean)
        .join(" ") || null,
    render: (f) =>
      f.rtCriticsScore == null && f.rtAudienceScore == null ? null : (
        <>
          {f.rtCriticsScore != null && (
            <OverlayChip>🍅 {f.rtCriticsScore}%</OverlayChip>
          )}
          {f.rtAudienceScore != null && (
            <OverlayChip>🍿 {f.rtAudienceScore}%</OverlayChip>
          )}
        </>
      ),
  },
  {
    key: "letterboxd",
    sortKey: "rating",
    label: "My rating",
    colClass: "w-16",
    text: (f) =>
      f.letterboxdRating != null ? `★ ${f.letterboxdRating}` : null,
    render: (f) =>
      f.letterboxdRating != null ? (
        <OverlayChip>
          <span className="text-lb-green">★</span> {f.letterboxdRating}
        </OverlayChip>
      ) : null,
  },
  {
    key: "tmdbRating",
    sortKey: "tmdbRating",
    label: "TMDB rating",
    colClass: "w-16",
    text: (f) => f.tmdbDetails?.voteAverage?.toFixed(1) ?? null,
  },
  {
    key: "price",
    sortKey: "price",
    label: "Price paid",
    colClass: "w-20",
    text: (f) => formatPrice(f.pricePaid),
  },
  {
    key: "budget",
    sortKey: "budget",
    label: "Budget",
    colClass: "w-20",
    text: (f) =>
      f.tmdbDetails?.budget
        ? formatUsdCompact(f.tmdbDetails.budget)
        : null,
  },
  {
    key: "boxoffice",
    sortKey: "boxoffice",
    label: "Box office",
    colClass: "w-20",
    text: (f) =>
      f.tmdbDetails?.revenue
        ? formatUsdCompact(f.tmdbDetails.revenue)
        : null,
  },
  {
    key: "roi",
    sortKey: "roi",
    label: "Return on budget",
    colClass: "w-16",
    text: (f) => {
      const multiple = roiMultiple(f)
      return multiple != null ? formatMultiple(multiple) : null
    },
  },
  {
    key: "runtime",
    sortKey: "runtime",
    label: "Runtime",
    colClass: "w-20",
    text: (f) =>
      f.runtimeMinutes != null ? formatRuntime(f.runtimeMinutes) : null,
  },
  {
    key: "publisher",
    sortKey: "publisher",
    label: "Publisher",
    colClass: "w-36",
    text: (f) => f.label,
  },
]

type OverlayKey = string

/** Grid chip: bespoke render when defined, plain chip from text otherwise. */
function overlayChips(def: OverlayDef, film: Film): React.ReactNode {
  if (def.render) return def.render(film)
  const value = def.text(film)
  return value ? <OverlayChip>{value}</OverlayChip> : null
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: Array<[string, number]>
  onChange: (value: string) => void
}) {
  const items = {
    [ANY]: "All",
    ...Object.fromEntries(options.map(([name]) => [name, name])),
  }
  return (
    <label className="space-y-1">
      <span className="text-muted-foreground block text-[11px] font-semibold tracking-[0.12em] uppercase">
        {label}
      </span>
      <Select value={value} items={items} onValueChange={(v) => onChange(v as string)}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>All</SelectItem>
          {options.map(([name, count]) => (
            <SelectItem key={name} value={name}>
              {name}{" "}
              <span className="text-muted-foreground text-xs">({count})</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  )
}

/** Fixed list-view columns; the metric columns come from the picker. */
const LIST_COLS = {
  poster: "w-11 shrink-0",
  title: "min-w-0 flex-1",
  format: "hidden w-28 shrink-0 sm:block",
  watched: "flex w-6 shrink-0 justify-end",
}

/** Picker-driven columns hide on small screens where they can't fit. */
const metricColClass = (def: OverlayDef) =>
  cn("hidden shrink-0 md:block", def.colClass)

function FilmRow({
  film,
  columns,
  subtext,
}: {
  film: Film
  /** Metric columns chosen in the "Poster info" picker. */
  columns: OverlayDef[]
  /** Extra value after the director — e.g. the metric the list is sorted by. */
  subtext?: string | null
}) {
  const watched = isWatched(film)
  return (
    <Link
      to="/films/$filmId"
      params={{ filmId: film.id }}
      className="hover:bg-secondary/40 flex items-center gap-3 px-3 py-2 transition-colors"
    >
      <div className={LIST_COLS.poster}>
        <PosterFrame coverUrl={film.coverUrl} title={film.title} />
      </div>
      <div className={LIST_COLS.title}>
        <p className="truncate text-sm font-medium">
          {film.title}
          {film.year != null && (
            <span className="text-muted-foreground font-normal">
              {" "}
              ({film.year})
            </span>
          )}
        </p>
        <p className="text-muted-foreground truncate text-xs">
          {[film.director, film.edition].filter(Boolean).join(" · ")}
          {subtext && (
            <span className="text-foreground font-medium tabular-nums">
              {film.director || film.edition ? " · " : ""}
              {subtext}
            </span>
          )}
        </p>
      </div>
      <p className={cn(LIST_COLS.format, "truncate text-xs")}>
        <FormatBadge format={film.format} />
        {film.hdr && (
          <span className="text-muted-foreground ml-1.5">{film.hdr}</span>
        )}
      </p>
      {columns.map((def) => (
        <p
          key={def.key}
          className={cn(metricColClass(def), "truncate text-xs tabular-nums")}
        >
          {def.text(film)}
        </p>
      ))}
      <span className={LIST_COLS.watched}>
        {watched && (
          <span
            title="Watched"
            className="bg-lb-green rounded-full p-1 text-[#07130b]"
          >
            <Eye className="size-3" />
          </span>
        )}
      </span>
    </Link>
  )
}

/** Clickable header cell — sets its sort, or flips direction when active. */
function HeaderSortButton({
  label,
  sortKey,
  activeSort,
  dir,
  onSort,
}: {
  label: string
  sortKey: SortKey
  activeSort: SortKey
  dir: "asc" | "desc"
  onSort: (key: SortKey) => void
}) {
  const active = activeSort === sortKey
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      className={cn(
        "hover:text-foreground flex items-center gap-1 truncate uppercase transition-colors",
        active && "text-foreground",
      )}
    >
      <span className="truncate">{label}</span>
      {active && <span aria-hidden>{dir === "asc" ? "▲" : "▼"}</span>}
    </button>
  )
}

function ListHeader({
  columns,
  sort,
  dir,
  onSort,
}: {
  columns: OverlayDef[]
  sort: SortKey
  dir: "asc" | "desc"
  onSort: (key: SortKey) => void
}) {
  return (
    <div className="text-muted-foreground flex items-center gap-3 border-b px-3 py-2 text-[11px] font-semibold tracking-[0.12em] uppercase">
      <div className={LIST_COLS.poster} />
      <div className={LIST_COLS.title}>
        <HeaderSortButton
          label="Title"
          sortKey="title"
          activeSort={sort}
          dir={dir}
          onSort={onSort}
        />
      </div>
      <div className={LIST_COLS.format}>
        <HeaderSortButton
          label="Format"
          sortKey="format"
          activeSort={sort}
          dir={dir}
          onSort={onSort}
        />
      </div>
      {columns.map((def) => (
        <div key={def.key} className={cn(metricColClass(def), "truncate")}>
          <HeaderSortButton
            label={def.label}
            sortKey={def.sortKey}
            activeSort={sort}
            dir={dir}
            onSort={onSort}
          />
        </div>
      ))}
      <div className={LIST_COLS.watched} />
    </div>
  )
}

function sortFilms(films: Film[], sort: SortKey, dir?: "asc" | "desc"): Film[] {
  const copy = [...films]
  const flip = dir != null && dir !== DEFAULT_DIR[sort]

  // Films missing the sorted value stay visible but always sink to the
  // bottom — flipping direction only reorders the films that have it.
  const byNumber = (valueOf: (f: Film) => number | null, desc: boolean) =>
    copy.sort((a, b) => {
      const av = valueOf(a)
      const bv = valueOf(b)
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      const cmp = desc ? bv - av : av - bv
      return flip ? -cmp : cmp
    })

  const metric = METRIC_SORTS[sort]
  if (metric) return byNumber(metric.valueOf, true)

  switch (sort) {
    case "spine":
      return byNumber((f) => f.spineNumber, false)
    case "year":
      return byNumber((f) => f.year, false)
    case "added":
      return byNumber((f) => new Date(f.createdAt).getTime(), true)
    case "publisher":
      return copy.sort((a, b) => {
        if (a.label == null && b.label == null) return 0
        if (a.label == null) return 1
        if (b.label == null) return -1
        const cmp = a.label.localeCompare(b.label)
        return flip ? -cmp : cmp
      })
    case "format":
      return byNumber(
        (f) => FORMATS.indexOf(f.format as (typeof FORMATS)[number]),
        false,
      )
    default:
      // Already sorted by sortTitle from the server.
      return flip ? copy.reverse() : copy
  }
}

/** Card subtext for the active sort — only when the film has the value. */
function metricSubtext(sort: SortKey, film: Film): string | undefined {
  const metric = METRIC_SORTS[sort]
  return metric && metric.valueOf(film) != null
    ? metric.display(film)
    : undefined
}

function CollectionPage() {
  const { data: films } = useSuspenseQuery(filmsQuery)
  const params = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const queryClient = useQueryClient()

  // ---- Saved views ---------------------------------------------------
  const { data: settings } = useQuery(settingsQuery)
  const savedViews = useMemo(
    () => settings?.savedViews ?? [],
    [settings?.savedViews],
  )

  /** The current URL state, as a saved view would store it. */
  const currentParams = useMemo(
    () =>
      sanitizeViewParams(
        Object.fromEntries(
          Object.entries(params).map(([k, v]) => [k, String(v)]),
        ),
      ),
    [params],
  )
  const activeView = savedViews.find((v) =>
    paramsEqual(sanitizeViewParams(v.params), currentParams),
  )

  const saveViews = useMutation({
    mutationFn: (views: SavedView[]) => saveViewsFn({ data: { views } }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["settings"] }),
    onError: () => toast.error("Could not save views"),
  })

  const applyView = (view: SavedView) => {
    navigate({ search: sanitizeViewParams(view.params), replace: true })
  }

  const [viewDialogOpen, setViewDialogOpen] = useState(false)
  const [viewName, setViewName] = useState("")
  const [viewDefault, setViewDefault] = useState(false)

  const saveCurrentView = () => {
    const name = viewName.trim()
    if (!name) return
    const view: SavedView = {
      name,
      params: currentParams,
      ...(viewDefault && { isDefault: true }),
    }
    const next = [
      ...savedViews
        .filter((v) => v.name !== name)
        // Only one view can be the default.
        .map((v) => (viewDefault ? { ...v, isDefault: undefined } : v)),
      view,
    ]
    saveViews.mutate(next, {
      onSuccess: () => {
        setViewDialogOpen(false)
        toast.success(`View “${name}” saved`)
      },
    })
  }

  const deleteView = (name: string) =>
    saveViews.mutate(savedViews.filter((v) => v.name !== name))

  const toggleDefaultView = (name: string) =>
    saveViews.mutate(
      savedViews.map((v) => ({
        ...v,
        isDefault: v.name === name ? !v.isDefault || undefined : undefined,
      })),
    )

  // A fresh visit with no URL state loads the default view.
  const defaultViewChecked = useRef(false)
  useEffect(() => {
    if (defaultViewChecked.current || !settings) return
    defaultViewChecked.current = true
    const def = settings.savedViews?.find((v) => v.isDefault)
    if (def && Object.keys(currentParams).length === 0) {
      applyView(def)
    }
  }, [settings])
  // ---------------------------------------------------------------------

  const sort: SortKey = params.sort ?? "title"
  const effectiveDir = params.dir ?? DEFAULT_DIR[sort]
  const letter = params.letter ?? null
  const view = params.view ?? "grid"
  // Comma-separated in the URL — several badges can stack on the posters.
  const overlayKeys = useMemo(
    () =>
      new Set(
        (params.overlay ?? "")
          .split(",")
          .filter((k) => OVERLAY_DEFS.some((d) => d.key === k)),
      ),
    [params.overlay],
  )
  const activeOverlays = OVERLAY_DEFS.filter((d) => overlayKeys.has(d.key))
  const toggleOverlay = (key: OverlayKey) => {
    const next = new Set(overlayKeys)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setParams({ overlay: next.size > 0 ? [...next].join(",") : null })
  }
  // Unmatched titles count as movies — physical shelves are mostly films.
  const typeFilter = params.type ?? "all"
  const isTv = (f: Film) => f.tmdbMediaType === "tv"
  const tvCount = useMemo(() => films.filter(isTv).length, [films])
  const filters: Filters = useMemo(
    () =>
      Object.fromEntries(
        FILTER_DEFS.map((d) => [d.key, params[d.key] ?? ANY]),
      ) as Filters,
    [params],
  )

  /** Merge a partial state change into the URL (replace — no history spam). */
  const setParams = (
    patch: Partial<Record<keyof z.infer<typeof searchSchema>, string | null>>,
  ) => {
    navigate({
      search: (prev) => {
        const next: Record<string, unknown> = { ...prev }
        for (const [key, value] of Object.entries(patch)) {
          if (value == null || value === "" || value === ANY) {
            delete next[key]
          } else {
            next[key] = value
          }
        }
        return next
      },
      replace: true,
    })
  }

  /** Header click: pick that sort, or flip direction when already active. */
  const onHeaderSort = (key: SortKey) => {
    if (sort === key) {
      setParams({
        dir:
          params.dir == null
            ? DEFAULT_DIR[key] === "asc"
              ? "desc"
              : "asc"
            : null,
      })
    } else {
      setParams({ sort: key === "title" ? null : key, dir: null, letter: null })
    }
  }

  // The search box types into local state; the URL follows, debounced.
  const [search, setSearch] = useState(params.q ?? "")
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    return () => {
      if (searchDebounce.current) clearTimeout(searchDebounce.current)
    }
  }, [])
  const onSearchChange = (value: string) => {
    setSearch(value)
    if (searchDebounce.current) clearTimeout(searchDebounce.current)
    searchDebounce.current = setTimeout(
      () => setParams({ q: value.trim() || null }),
      300,
    )
  }

  const hasUrlFilters = FILTER_DEFS.some((d) => params[d.key] != null)
  const [filtersOpen, setFiltersOpen] = useState(hasUrlFilters)

  const presentLetters = useMemo(() => new Set(films.map(sortLetter)), [films])

  // Distinct values (with counts) present in the collection, per filter.
  const filterOptions = useMemo(() => {
    const result = {} as Record<FilterKey, Array<[string, number]>>
    for (const def of FILTER_DEFS) {
      const counts = new Map<string, number>()
      for (const film of films) {
        const value = def.valueOf(film)
        if (value == null || value === "") continue
        counts.set(value, (counts.get(value) ?? 0) + 1)
      }
      result[def.key] = [...counts.entries()].sort((a, b) =>
        a[0].localeCompare(b[0], undefined, { numeric: true }),
      )
    }
    return result
  }, [films])

  const activeFilterCount = FILTER_DEFS.filter(
    (d) => filters[d.key] !== ANY,
  ).length

  const visible = useMemo(() => {
    let list = sortFilms(films, sort, params.dir)
    if (typeFilter !== "all") {
      list = list.filter((f) => (typeFilter === "tv" ? isTv(f) : !isTv(f)))
    }
    const q = search.trim().toLowerCase()
    if (q) {
      list = list.filter(
        (f) =>
          f.title.toLowerCase().includes(q) ||
          f.director?.toLowerCase().includes(q) ||
          f.label?.toLowerCase().includes(q) ||
          (f.spineNumber != null && `#${f.spineNumber}`.includes(q))
      )
    }
    for (const def of FILTER_DEFS) {
      const wanted = filters[def.key]
      if (wanted === ANY) continue
      list = list.filter((f) => def.valueOf(f) === wanted)
    }
    if (letter && sort === "title") {
      list = list.filter((f) => sortLetter(f) === letter)
    }
    return list
  }, [films, search, sort, params.dir, letter, filters, typeFilter])

  const watchedCount = films.filter(isWatched).length

  if (films.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>Your shelf is empty</EmptyTitle>
          <EmptyDescription>
            Add your first disc to start cataloguing your collection.
          </EmptyDescription>
        </EmptyHeader>
        <div className="flex gap-2">
          <Button render={<Link to="/add" />}>Add a film</Button>
          <Button
            variant="outline"
            render={<Link to="/add" search={{ scan: "1" }} />}
          >
            Scan a barcode
          </Button>
        </div>
      </Empty>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Collection</h1>
          <p className="text-sm text-muted-foreground">
            {films.length} title{films.length === 1 ? "" : "s"} ·{" "}
            <span className="text-lb-green">{watchedCount} watched</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search title, director, spine…"
              className="w-64 pl-8"
            />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="outline"
                  className="w-44 justify-between gap-2 font-normal"
                />
              }
            >
              <span className="truncate">{SORT_LABELS[sort]}</span>
              <span aria-hidden className="text-muted-foreground text-xs">
                {effectiveDir === "asc" ? "▲" : "▼"}
              </span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {(Object.entries(SORT_LABELS) as Array<[SortKey, string]>).map(
                ([key, label]) => (
                  <DropdownMenuItem
                    key={key}
                    closeOnClick={false}
                    className="justify-between gap-4"
                    onClick={() => onHeaderSort(key)}
                  >
                    {label}
                    {sort === key && (
                      <span aria-hidden className="text-xs">
                        {effectiveDir === "asc" ? "▲" : "▼"}
                      </span>
                    )}
                  </DropdownMenuItem>
                ),
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant={activeOverlays.length > 0 ? "secondary" : "outline"}
                  className="gap-2"
                />
              }
            >
              {view === "list" ? "Columns" : "Poster info"}
              {activeOverlays.length > 0 && (
                <span className="bg-lb-green rounded-full px-1.5 text-xs font-bold text-[#07130b] tabular-nums">
                  {activeOverlays.length}
                </span>
              )}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {OVERLAY_DEFS.map((d) => (
                <DropdownMenuCheckboxItem
                  key={d.key}
                  checked={overlayKeys.has(d.key)}
                  closeOnClick={false}
                  onCheckedChange={() => toggleOverlay(d.key)}
                >
                  {d.label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <div className="flex rounded-md border">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Grid view"
              aria-pressed={view === "grid"}
              className={cn(
                "rounded-r-none",
                view === "grid" && "bg-secondary",
              )}
              onClick={() => setParams({ view: null })}
            >
              <LayoutGrid className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="List view"
              aria-pressed={view === "list"}
              className={cn(
                "rounded-l-none",
                view === "list" && "bg-secondary",
              )}
              onClick={() => setParams({ view: "list" })}
            >
              <List className="size-4" />
            </Button>
          </div>
          <Button
            variant={activeFilterCount > 0 ? "secondary" : "outline"}
            className="gap-2"
            aria-expanded={filtersOpen}
            onClick={() => setFiltersOpen((open) => !open)}
          >
            <SlidersHorizontal className="size-4" />
            Filters
            {activeFilterCount > 0 && (
              <span className="rounded-full bg-lb-green px-1.5 text-xs font-bold text-[#07130b] tabular-nums">
                {activeFilterCount}
              </span>
            )}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant={activeView ? "secondary" : "outline"}
                  className="gap-2"
                />
              }
            >
              <Bookmark className="size-4" />
              {activeView ? activeView.name : "Views"}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-56">
              {savedViews.map((saved) => (
                <DropdownMenuItem
                  key={saved.name}
                  className="gap-2"
                  onClick={() => applyView(saved)}
                >
                  <span className="min-w-0 flex-1 truncate">{saved.name}</span>
                  <button
                    type="button"
                    aria-label={
                      saved.isDefault
                        ? `Unset ${saved.name} as default view`
                        : `Set ${saved.name} as default view`
                    }
                    title={saved.isDefault ? "Default view" : "Make default"}
                    className="text-muted-foreground hover:text-foreground shrink-0"
                    onClick={(e) => {
                      e.stopPropagation()
                      toggleDefaultView(saved.name)
                    }}
                  >
                    <Star
                      className={cn(
                        "size-3.5",
                        saved.isDefault && "fill-lb-orange text-lb-orange",
                      )}
                    />
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete view ${saved.name}`}
                    title="Delete view"
                    className="text-muted-foreground hover:text-destructive shrink-0"
                    onClick={(e) => {
                      e.stopPropagation()
                      deleteView(saved.name)
                    }}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </DropdownMenuItem>
              ))}
              {savedViews.length > 0 && <DropdownMenuSeparator />}
              <DropdownMenuItem
                onClick={() => {
                  setViewName(activeView?.name ?? "")
                  setViewDefault(activeView?.isDefault ?? false)
                  setViewDialogOpen(true)
                }}
              >
                Save current view…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Save-view dialog */}
      <Dialog open={viewDialogOpen} onOpenChange={setViewDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Save current view</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault()
              saveCurrentView()
            }}
          >
            <Field>
              <FieldLabel htmlFor="view-name">Name</FieldLabel>
              <Input
                id="view-name"
                autoFocus
                placeholder="e.g. Criterion steelbooks, unwatched 4K…"
                value={viewName}
                onChange={(e) => setViewName(e.target.value)}
              />
            </Field>
            <label className="flex items-center justify-between gap-3 text-sm">
              <span>
                Set as default view
                <span className="text-muted-foreground block text-xs">
                  Loaded whenever you open the collection fresh.
                </span>
              </span>
              <Switch
                checked={viewDefault}
                onCheckedChange={setViewDefault}
              />
            </label>
            <p className="text-muted-foreground text-xs">
              Saves the current search, filters, sort, poster info, and
              grid/list choice. Reusing a name overwrites that view.
            </p>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setViewDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={!viewName.trim() || saveViews.isPending}
              >
                {saveViews.isPending && (
                  <Loader2 className="size-4 animate-spin" />
                )}
                Save view
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <div
        role="group"
        aria-label="Filter by media type"
        className="bg-secondary/50 flex w-fit gap-0.5 rounded-lg border p-0.5"
      >
        {(
          [
            ["all", `All (${films.length})`],
            ["movie", `Movies (${films.length - tvCount})`],
            ["tv", `TV (${tvCount})`],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={typeFilter === key}
            onClick={() => setParams({ type: key === "all" ? null : key })}
            className={cn(
              "rounded-md px-3 py-1 text-sm font-medium transition-colors",
              typeFilter === key
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {filtersOpen && (
        <div className="bg-card space-y-3 rounded-lg border p-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {FILTER_DEFS.map((def) => (
              <FilterSelect
                key={def.key}
                label={def.label}
                value={filters[def.key]}
                options={filterOptions[def.key]}
                onChange={(value) =>
                  setParams({ [def.key]: value })
                }
              />
            ))}
          </div>
          {activeFilterCount > 0 && (
            <div className="flex items-center justify-between gap-2">
              <p className="text-muted-foreground text-xs">
                {visible.length} title{visible.length === 1 ? "" : "s"} match
              </p>
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5"
                onClick={() =>
                  setParams(
                    Object.fromEntries(FILTER_DEFS.map((d) => [d.key, null])),
                  )
                }
              >
                <X className="size-3.5" /> Clear all
              </Button>
            </div>
          )}
        </div>
      )}

      {sort === "title" && (
        <nav
          aria-label="Browse alphabetically"
          className="flex flex-wrap gap-0.5"
        >
          <button
            type="button"
            onClick={() => setParams({ letter: null })}
            className={cn(
              "rounded px-1.5 py-0.5 text-xs font-bold",
              letter === null
                ? "bg-lb-green text-[#07130b]"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            ALL
          </button>
          {LETTERS.map((l) => (
            <button
              key={l}
              type="button"
              disabled={!presentLetters.has(l)}
              onClick={() => setParams({ letter: letter === l ? null : l })}
              className={cn(
                "rounded px-1.5 py-0.5 text-xs font-bold tabular-nums",
                letter === l
                  ? "bg-lb-green text-[#07130b]"
                  : "text-muted-foreground hover:text-foreground disabled:opacity-25"
              )}
            >
              {l}
            </button>
          ))}
        </nav>
      )}

      {METRIC_SORTS[sort] && (
        <p className="text-xs tracking-wide text-muted-foreground uppercase">
          Sorted by {SORT_LABELS[sort].toLowerCase()},{" "}
          {effectiveDir === "desc" ? "highest" : "lowest"} first — titles
          without {METRIC_SORTS[sort].label} sort last
        </p>
      )}

      {visible.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No matches</EmptyTitle>
            <EmptyDescription>
              Nothing in your collection matches this filter.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : view === "list" ? (
        <div className="divide-border/60 divide-y rounded-lg border">
          <ListHeader
            columns={activeOverlays}
            sort={sort}
            dir={effectiveDir}
            onSort={onHeaderSort}
          />
          {visible.map((film) => (
            <FilmRow
              key={film.id}
              film={film}
              columns={activeOverlays}
              subtext={metricSubtext(sort, film)}
            />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-x-3 gap-y-5 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
          {visible.map((film) => (
            <FilmCard
              key={film.id}
              film={film}
              overlay={
                activeOverlays.length > 0
                  ? activeOverlays.map((d) => (
                      <span key={d.key} className="contents">
                        {overlayChips(d, film)}
                      </span>
                    ))
                  : undefined
              }
              subtext={metricSubtext(sort, film)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
