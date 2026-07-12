import { Link } from "@tanstack/react-router"
import { Eye } from "lucide-react"
import type { Film } from "@/db/schema"
import { isWatched } from "@/lib/film-helpers"
import { cn } from "@/lib/utils"

export function PosterFrame({
  coverUrl,
  title,
  className,
}: {
  coverUrl: string | null
  title: string
  className?: string
}) {
  return (
    <div
      className={cn(
        "relative aspect-2/3 w-full overflow-hidden rounded-md bg-secondary",
        className
      )}
    >
      {coverUrl ? (
        <img
          src={coverUrl}
          alt={`${title} cover`}
          loading="lazy"
          className="absolute inset-0 size-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center p-3">
          <span className="text-center text-xs leading-snug font-semibold tracking-wide text-muted-foreground uppercase">
            {title}
          </span>
        </div>
      )}
    </div>
  )
}

export function FilmCard({ film }: { film: Film }) {
  const watched = isWatched(film)
  return (
    <Link
      to="/films/$filmId"
      params={{ filmId: film.id }}
      className="group block rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="relative">
        <PosterFrame
          coverUrl={film.coverUrl}
          title={film.title}
          className="ring-1 ring-border/60 transition group-hover:ring-2 group-hover:ring-lb-green"
        />
        {film.spineNumber != null && (
          <span className="absolute top-1.5 left-1.5 rounded-sm bg-background/85 px-1.5 py-0.5 text-[10px] font-bold text-foreground tabular-nums backdrop-blur">
            #{film.spineNumber}
          </span>
        )}
        {watched && (
          <span
            title="Watched"
            className="absolute right-1.5 bottom-1.5 rounded-full bg-lb-green p-1 text-[#07130b]"
          >
            <Eye className="size-3" />
          </span>
        )}
      </div>
      <div className="mt-1.5 space-y-0.5 px-0.5">
        <p className="truncate text-sm leading-tight font-medium">
          {film.title}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {[film.year, film.format].filter(Boolean).join(" · ")}
        </p>
      </div>
    </Link>
  )
}
