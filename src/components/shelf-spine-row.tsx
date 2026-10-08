import { Link } from "@tanstack/react-router"
import { Check, Plus, TriangleAlert } from "lucide-react"
import { useId } from "react"
import { filmLabel } from "@/components/duplicate-warning"
import { FormatBadge } from "@/components/film-card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { Film } from "@/db/schema"
import type { ShelfSpine } from "@/lib/shelf-reading"

/** A titled, counted section of Shelf check results. */
export function ResultSection({
  title,
  count,
  children,
}: {
  title: string
  count: number
  children: React.ReactNode
}) {
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <h2
        id={headingId}
        className="flex items-center gap-2 text-sm font-bold tracking-tight"
      >
        {title}
        <span className="text-xs font-normal text-muted-foreground tabular-nums">
          {count}
        </span>
      </h2>
      {children}
    </section>
  )
}

const LEGIBILITY_HINT = {
  partial: "Partly hidden or blurred — check the title",
  unclear: "Couldn't read it clearly — the title is a guess",
} as const

/** What the spine shows: year, format, label, spine number, legibility. */
export function SpineChips({ spine }: { spine: ShelfSpine }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {spine.year != null && <Badge variant="outline">{spine.year}</Badge>}
      {spine.format && <FormatBadge format={spine.format} />}
      {spine.label && <Badge variant="secondary">{spine.label}</Badge>}
      {spine.spineNumber != null && (
        <Badge className="bg-lb-blue text-[#06131b]">
          Spine #{spine.spineNumber}
        </Badge>
      )}
      {spine.legibility !== "clear" && (
        <Badge
          className="bg-lb-orange/15 text-lb-orange"
          title={LEGIBILITY_HINT[spine.legibility]}
        >
          <TriangleAlert /> Hard to read
          <span className="sr-only">
            {" "}
            — {LEGIBILITY_HINT[spine.legibility]}
          </span>
        </Badge>
      )}
    </div>
  )
}

/**
 * A spine that isn't catalogued (in its format), with how to add it — or
 * a link to the copy added since. Adding returns to the Shelf check, to the
 * order check of `checkShelf` when given.
 */
export function SpineRow({
  spine,
  added,
  checkShelf,
}: {
  spine: ShelfSpine
  added: Film | null
  checkShelf?: string
}) {
  const owned = spine.film
  return (
    <li className="flex flex-wrap items-start gap-3 rounded-lg border bg-card p-3 sm:flex-nowrap">
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="leading-tight font-medium">{spine.title}</p>
        <p className="text-xs break-words text-muted-foreground">
          <span className="sr-only">Spine reads </span>“{spine.text}”
        </p>
        <SpineChips spine={spine} />
        {spine.status === "other-format" && owned && !added && (
          <p className="text-xs text-muted-foreground">
            You have it on{" "}
            <Link
              to="/films/$filmId"
              params={{ filmId: owned.id }}
              className="font-medium text-foreground underline-offset-2 hover:text-lb-green hover:underline"
            >
              {owned.format}
            </Link>
          </p>
        )}
      </div>
      {added ? (
        <Link
          to="/films/$filmId"
          params={{ filmId: added.id }}
          aria-label={`Added ${filmLabel(added)} on ${added.format} — open it`}
          className="flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-lb-green outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Check className="size-3.5" /> Added
          {spine.format &&
            spine.format !== added.format &&
            ` on ${added.format}`}
        </Link>
      ) : (
        <Button
          nativeButton={false}
          size="sm"
          variant={spine.status === "missing" ? "default" : "outline"}
          className="shrink-0 gap-1.5"
          aria-label={`Add ${spine.title}`}
          render={
            <Link
              to="/add"
              search={{
                title: spine.title,
                year: spine.year?.toString(),
                format: spine.format ?? undefined,
                importQuery: spine.title,
                from: "shelf-check",
                checkShelf,
              }}
            />
          }
        >
          <Plus className="size-3.5" /> Add
        </Button>
      )}
    </li>
  )
}
