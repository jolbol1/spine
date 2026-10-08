import { Link } from "@tanstack/react-router"
import { Copy, TriangleAlert } from "lucide-react"
import { isSameDisc } from "@/lib/collection-match"
import type { DuplicateMatch } from "@/lib/collection-match"
import type { Film } from "@/db/schema"
import { cn } from "@/lib/utils"

function reasonText({ film, reason }: DuplicateMatch): string {
  switch (reason) {
    case "barcode":
      return "Same barcode — this exact disc is already catalogued."
    case "same-format":
      return "Already in your collection."
    case "other-format":
      return `You have it on ${film.format} — this would be another copy.`
  }
}

/** "Title (year)", as the collection lists it. */
export function filmLabel(film: Pick<Film, "title" | "year">): string {
  return film.year != null ? `${film.title} (${film.year})` : film.title
}

export function SmallCover({
  coverUrl,
  className,
}: {
  coverUrl: string | null
  className?: string
}) {
  return coverUrl ? (
    <img
      src={coverUrl}
      alt=""
      loading="lazy"
      className={cn(
        "h-12 w-8 shrink-0 rounded-sm bg-secondary object-cover",
        className
      )}
    />
  ) : (
    <span
      className={cn("h-12 w-8 shrink-0 rounded-sm bg-secondary", className)}
    />
  )
}

/**
 * The collection's copies of the disc about to be added, most certain
 * first. Orange when it would be the same disc again, blue when it would
 * be another edition. Links open in a new tab so the form isn't lost.
 */
export function DuplicateWarning({
  matches,
  className,
}: {
  matches: ReadonlyArray<DuplicateMatch>
  className?: string
}) {
  if (matches.length === 0) return null
  const sameDisc = isSameDisc(matches)
  const Icon = sameDisc ? TriangleAlert : Copy
  return (
    <div
      className={cn(
        "rounded-lg border p-3",
        sameDisc
          ? "border-lb-orange/40 bg-lb-orange/10"
          : "border-lb-blue/40 bg-lb-blue/10",
        className
      )}
    >
      <p className="flex items-center gap-2 text-sm font-medium">
        <Icon
          className={cn(
            "size-4 shrink-0",
            sameDisc ? "text-lb-orange" : "text-lb-blue"
          )}
        />
        {sameDisc
          ? "You may already have this disc"
          : "You have this title in another format"}
      </p>
      <ul className="mt-2 space-y-2">
        {matches.map((match) => (
          <li key={match.film.id} className="flex items-center gap-3">
            <SmallCover coverUrl={match.film.coverUrl} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {filmLabel(match.film)} · {match.film.format}
              </p>
              <p className="text-xs text-muted-foreground">
                {reasonText(match)}
              </p>
            </div>
            <Link
              to="/films/$filmId"
              params={{ filmId: match.film.id }}
              target="_blank"
              aria-label={`Open ${filmLabel(match.film)} in a new tab`}
              className="shrink-0 rounded-sm px-1 text-xs font-medium text-lb-green underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
            >
              Open
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
