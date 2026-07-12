import { useSuspenseQuery } from "@tanstack/react-query"
import { Link, createFileRoute } from "@tanstack/react-router"
import { Search } from "lucide-react"
import { useMemo, useState } from "react"
import { FilmCard } from "@/components/film-card"
import { Button } from "@/components/ui/button"
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
import type { Film } from "@/db/schema"
import { isWatched, sortLetter } from "@/lib/film-helpers"
import { filmsQuery } from "@/lib/queries"
import { cn } from "@/lib/utils"

export const Route = createFileRoute("/_app/")({
  loader: ({ context }) => context.queryClient.ensureQueryData(filmsQuery),
  component: CollectionPage,
})

type SortKey = "title" | "spine" | "year" | "added"

const LETTERS = ["#", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"] as const

function sortFilms(films: Film[], sort: SortKey): Film[] {
  const copy = [...films]
  switch (sort) {
    case "spine":
      return copy
        .filter((f) => f.spineNumber != null)
        .sort((a, b) => a.spineNumber! - b.spineNumber!)
    case "year":
      return copy.sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999))
    case "added":
      return copy.sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      )
    default:
      return copy // already sorted by sortTitle from the server
  }
}

function CollectionPage() {
  const { data: films } = useSuspenseQuery(filmsQuery)
  const [search, setSearch] = useState("")
  const [sort, setSort] = useState<SortKey>("title")
  const [letter, setLetter] = useState<string | null>(null)

  const presentLetters = useMemo(() => new Set(films.map(sortLetter)), [films])

  const visible = useMemo(() => {
    let list = sortFilms(films, sort)
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
    if (letter && sort === "title") {
      list = list.filter((f) => sortLetter(f) === letter)
    }
    return list
  }, [films, search, sort, letter])

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
          <Button variant="outline" render={<Link to="/scan" />}>
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
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search title, director, spine…"
              className="w-64 pl-8"
            />
          </div>
          <Select
            value={sort}
            items={{
              title: "Alphabetical",
              spine: "Criterion spine #",
              year: "Release year",
              added: "Recently added",
            }}
            onValueChange={(v) => {
              setSort(v as SortKey)
              setLetter(null)
            }}
          >
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="title">Alphabetical</SelectItem>
              <SelectItem value="spine">Criterion spine #</SelectItem>
              <SelectItem value="year">Release year</SelectItem>
              <SelectItem value="added">Recently added</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {sort === "title" && (
        <nav
          aria-label="Browse alphabetically"
          className="flex flex-wrap gap-0.5"
        >
          <button
            type="button"
            onClick={() => setLetter(null)}
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
              onClick={() => setLetter(letter === l ? null : l)}
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

      {sort === "spine" && (
        <p className="text-xs tracking-wide text-muted-foreground uppercase">
          Showing {visible.length} title{visible.length === 1 ? "" : "s"} with a
          Criterion spine number
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
      ) : (
        <div className="grid grid-cols-3 gap-x-3 gap-y-5 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
          {visible.map((film) => (
            <FilmCard key={film.id} film={film} />
          ))}
        </div>
      )}
    </div>
  )
}
