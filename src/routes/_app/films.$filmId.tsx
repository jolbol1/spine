import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router"
import {
  ExternalLink,
  Eye,
  EyeOff,
  Loader2,
  Pencil,
  RefreshCw,
  RotateCcw,
  Trash2,
  TriangleAlert,
} from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { PosterFrame } from "@/components/film-card"
import { FilmForm, filmToValues, valuesToInput } from "@/components/film-form"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Separator } from "@/components/ui/separator"
import {
  directorsOf,
  formatBadgeClass,
  formatPrice,
  formatRuntime,
  isWatched,
  resolutionOf,
} from "@/lib/film-helpers"
import { filmQuery } from "@/lib/queries"
import {
  deleteFilmFn,
  setWatchedOverrideFn,
  updateFilmFn,
} from "@/server/films"
import { refreshRtScoresFn } from "@/server/rottentomatoes"
import { rematchTmdbFn } from "@/server/tmdb"

export const Route = createFileRoute("/_app/films/$filmId")({
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(filmQuery(params.filmId)),
  component: FilmDetailPage,
})

function MetaRow({ label, value }: { label: string; value: React.ReactNode }) {
  if (value == null || value === "") return null
  return (
    <div className="flex justify-between gap-4 py-2">
      <dt className="text-xs font-semibold tracking-[0.12em] text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className="text-right text-sm">{value}</dd>
    </div>
  )
}

function FilmDetailPage() {
  const { filmId } = Route.useParams()
  const { data: film } = useSuspenseQuery(filmQuery(filmId))
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["films"] })

  const update = useMutation({
    mutationFn: updateFilmFn,
    onSuccess: async (result) => {
      if (result && "error" in result) {
        toast.error(result.error)
        return
      }
      await invalidate()
      setEditing(false)
      toast.success("Film updated")
    },
    onError: () => toast.error("Could not save changes"),
  })

  const setOverride = useMutation({
    mutationFn: setWatchedOverrideFn,
    onSuccess: invalidate,
    onError: () => toast.error("Could not update watched state"),
  })

  const rematch = useMutation({
    mutationFn: rematchTmdbFn,
    onSuccess: async (result) => {
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      await invalidate()
      toast.success(`Matched on TMDB — ${result.castCount} cast members added`)
    },
    onError: () => toast.error("TMDB lookup failed"),
  })

  const rtRefresh = useMutation({
    mutationFn: refreshRtScoresFn,
    onSuccess: async (result) => {
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      await invalidate()
      toast.success(
        `Rotten Tomatoes — critics ${result.criticsScore ?? "–"}%, audience ${result.audienceScore ?? "–"}%`,
      )
    },
    onError: () => toast.error("Could not reach Rotten Tomatoes"),
  })

  const remove = useMutation({
    mutationFn: deleteFilmFn,
    onSuccess: async () => {
      await invalidate()
      toast.success("Removed from collection")
      await navigate({ to: "/" })
    },
    onError: () => toast.error("Could not delete"),
  })

  if (!film) {
    return (
      <p className="py-16 text-center text-muted-foreground">
        This film is no longer in your collection.
      </p>
    )
  }

  const watched = isWatched(film)
  const overridden = film.watchedOverride != null

  return (
    <div className="grid gap-8 md:grid-cols-[260px_1fr]">
      <div className="space-y-3">
        <PosterFrame coverUrl={film.coverUrl} title={film.title} />
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="flex-1 gap-2"
            onClick={() => setEditing(true)}
          >
            <Pencil className="size-4" /> Edit
          </Button>
          <Button
            variant="destructive"
            size="icon"
            aria-label="Delete film"
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>

      <div className="space-y-6">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-bold tracking-tight">{film.title}</h1>
            {film.year && (
              <span className="text-xl text-muted-foreground">{film.year}</span>
            )}
          </div>
          {film.director && (
            <p className="text-muted-foreground">
              Directed by{" "}
              {directorsOf(film).map((name, i) => (
                <span key={name}>
                  {i > 0 && ", "}
                  <Link
                    to="/people/$person"
                    params={{ person: name }}
                    className="text-foreground font-medium transition-colors hover:text-lb-green"
                  >
                    {name}
                  </Link>
                </span>
              ))}
            </p>
          )}
          <div className="flex flex-wrap gap-1.5 pt-1">
            <Badge className={formatBadgeClass(film.format)}>
              {film.format}
            </Badge>
            {film.hdr && <Badge variant="secondary">{film.hdr}</Badge>}
            {film.spineNumber != null && (
              <Badge className="bg-lb-blue text-[#06131b]">
                Spine #{film.spineNumber}
              </Badge>
            )}
            {watched ? (
              <Badge className="bg-lb-green text-[#07130b]">
                <Eye className="size-3" /> Watched
              </Badge>
            ) : (
              <Badge variant="outline">
                <EyeOff className="size-3" /> Unwatched
              </Badge>
            )}
            {(film.rtCriticsScore != null ||
              film.rtAudienceScore != null) && (
              <a
                href={film.rtUrl ?? undefined}
                target="_blank"
                rel="noreferrer"
                className="inline-flex gap-1.5"
                title="View on Rotten Tomatoes"
              >
                {film.rtCriticsScore != null && (
                  <Badge
                    className={
                      film.rtCriticsScore >= 60
                        ? "bg-[#e01e26] text-white"
                        : "bg-[#6a7f10] text-white"
                    }
                  >
                    🍅 {film.rtCriticsScore}%
                  </Badge>
                )}
                {film.rtAudienceScore != null && (
                  <Badge className="bg-lb-orange text-[#1b0f04]">
                    🍿 {film.rtAudienceScore}%
                  </Badge>
                )}
              </a>
            )}
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground inline-flex items-center transition-colors disabled:opacity-50"
              title={
                film.rtSyncedAt
                  ? "Refresh Rotten Tomatoes scores"
                  : "Fetch Rotten Tomatoes scores"
              }
              aria-label="Refresh Rotten Tomatoes scores"
              disabled={rtRefresh.isPending}
              onClick={() => rtRefresh.mutate({ data: { id: film.id } })}
            >
              <RefreshCw
                className={`size-3.5 ${rtRefresh.isPending ? "animate-spin" : ""}`}
              />
            </button>
          </div>
          {film.tmdbDetails && film.tmdbDetails.genres.length > 0 && (
            <p className="text-muted-foreground pt-1 text-sm">
              {film.tmdbDetails.genres.join(" · ")}
            </p>
          )}
        </div>

        {film.tmdbId == null && (
          <div className="border-lb-orange/40 bg-lb-orange/10 flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
            <div className="flex items-start gap-2.5">
              <TriangleAlert className="text-lb-orange mt-0.5 size-4 shrink-0" />
              <div>
                <p className="text-sm font-medium">No TMDB match</p>
                <p className="text-muted-foreground text-xs">
                  Cast, genres, studio, and the IMDb link are missing because
                  this title wasn't found on TMDB. Check the title and year
                  (Edit), then retry.
                </p>
              </div>
            </div>
            <Button
              size="sm"
              variant="secondary"
              className="gap-1.5"
              disabled={rematch.isPending}
              onClick={() => rematch.mutate({ data: { id: film.id } })}
            >
              {rematch.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
              Retry match
            </Button>
          </div>
        )}

        {/* Watched control */}
        <div className="rounded-lg border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="flex items-center gap-2 text-sm font-medium">
                Watched tracking
                {film.letterboxdRating != null && (
                  <span
                    className="text-lb-green font-bold tracking-tight"
                    title={`Rated ${film.letterboxdRating} on Letterboxd`}
                  >
                    {"★".repeat(Math.floor(film.letterboxdRating))}
                    {film.letterboxdRating % 1 !== 0 && "½"}
                  </span>
                )}
                {film.letterboxdLiked && (
                  <span
                    className="text-lb-orange"
                    title="Liked on Letterboxd"
                    aria-label="Liked on Letterboxd"
                  >
                    ♥
                  </span>
                )}
              </p>
              <p className="text-xs text-muted-foreground">
                {overridden
                  ? "Manually pinned — the Letterboxd sync won't change this."
                  : film.letterboxdWatched
                    ? `Synced from Letterboxd${
                        film.letterboxdWatchedAt
                          ? ` — first watched ${new Date(film.letterboxdWatchedAt).toLocaleDateString()}`
                          : ""
                      }`
                    : "Following the Letterboxd sync (not seen yet)."}
              </p>
            </div>
            <div className="flex gap-2">
              {film.tmdbId != null && (
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  render={
                    <a
                      href={`https://www.themoviedb.org/${film.tmdbMediaType === "tv" ? "tv" : "movie"}/${film.tmdbId}`}
                      target="_blank"
                      rel="noreferrer"
                    />
                  }
                >
                  <ExternalLink className="size-3.5" /> TMDB
                </Button>
              )}
              {film.tmdbDetails?.imdbId && (
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  render={
                    <a
                      href={`https://www.imdb.com/title/${film.tmdbDetails.imdbId}/`}
                      target="_blank"
                      rel="noreferrer"
                    />
                  }
                >
                  <ExternalLink className="size-3.5" /> IMDb
                </Button>
              )}
              {film.letterboxdUri && (
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  render={
                    <a
                      href={film.letterboxdUri}
                      target="_blank"
                      rel="noreferrer"
                    />
                  }
                >
                  <ExternalLink className="size-3.5" /> Letterboxd
                </Button>
              )}
              <Button
                size="sm"
                variant={watched ? "secondary" : "default"}
                disabled={setOverride.isPending}
                onClick={() =>
                  setOverride.mutate({
                    data: { id: film.id, watched: !watched },
                  })
                }
              >
                Mark {watched ? "unwatched" : "watched"}
              </Button>
              {overridden && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="gap-1.5"
                  disabled={setOverride.isPending}
                  onClick={() =>
                    setOverride.mutate({ data: { id: film.id, watched: null } })
                  }
                >
                  <RotateCcw className="size-3.5" /> Follow sync
                </Button>
              )}
            </div>
          </div>
        </div>

        <div>
          <h2 className="mb-1 text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">
            Disc details
          </h2>
          <Separator />
          <dl className="divide-y divide-border/60">
            <MetaRow label="Resolution" value={resolutionOf(film)} />
            <MetaRow label="Audio" value={film.audio} />
            <MetaRow label="HDR" value={film.hdr ?? "SDR"} />
            <MetaRow label="Region" value={film.region} />
            <MetaRow label="Publisher" value={film.label} />
            <MetaRow label="Package" value={film.packageType} />
            <MetaRow label="Edition" value={film.edition} />
            <MetaRow
              label="Runtime"
              value={
                film.runtimeMinutes ? formatRuntime(film.runtimeMinutes) : null
              }
            />
            <MetaRow
              label="Discs"
              value={film.discCount > 1 ? film.discCount : null}
            />
            <MetaRow label="Barcode" value={film.barcode} />
            <MetaRow label="Price paid" value={formatPrice(film.pricePaid)} />
            <MetaRow
              label="Studio"
              value={film.tmdbDetails?.productionCompanies
                .slice(0, 3)
                .join(", ")}
            />
            <MetaRow
              label="Country"
              value={film.tmdbDetails?.productionCountries.join(", ")}
            />
            <MetaRow
              label="Added"
              value={new Date(film.createdAt).toLocaleDateString()}
            />
          </dl>
        </div>

        {film.tmdbCast && film.tmdbCast.length > 0 && (
          <div>
            <h2 className="mb-3 text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">
              Cast
            </h2>
            <div className="flex flex-wrap gap-2">
              {film.tmdbCast.map((member) => (
                <Link
                  key={member.id}
                  to="/people/$person"
                  params={{ person: member.name }}
                  className="bg-card flex items-center gap-2 rounded-full border py-1 pr-3 pl-1 transition-colors hover:border-lb-green"
                >
                  {member.profilePath ? (
                    <img
                      src={`https://image.tmdb.org/t/p/w185${member.profilePath}`}
                      alt=""
                      loading="lazy"
                      className="size-7 rounded-full object-cover"
                    />
                  ) : (
                    <span className="bg-secondary flex size-7 items-center justify-center rounded-full text-[10px] font-bold">
                      {member.name
                        .split(" ")
                        .map((part) => part[0])
                        .slice(0, 2)
                        .join("")}
                    </span>
                  )}
                  <span className="text-sm leading-none">
                    {member.name}
                    {member.character && (
                      <span className="text-muted-foreground block pt-0.5 text-[11px] leading-none">
                        {member.character}
                      </span>
                    )}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        )}

        {film.letterboxdReview && (
          <div>
            <h2 className="mb-2 text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">
              My review
            </h2>
            <blockquote className="border-lb-green/50 border-l-2 pl-3 text-sm whitespace-pre-wrap">
              {film.letterboxdReview}
            </blockquote>
          </div>
        )}

        {film.notes && (
          <div>
            <h2 className="mb-2 text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">
              Notes
            </h2>
            <p className="text-sm whitespace-pre-wrap">{film.notes}</p>
          </div>
        )}
      </div>

      {/* Edit dialog */}
      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Edit “{film.title}”</DialogTitle>
          </DialogHeader>
          <FilmForm
            initial={filmToValues(film)}
            submitLabel="Save changes"
            pending={update.isPending}
            onSubmit={(values) =>
              update.mutate({
                data: { id: film.id, ...valuesToInput(values) },
              })
            }
          />
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete “{film.title}”?</DialogTitle>
            <DialogDescription>
              This removes the title from your collection permanently.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => remove.mutate({ data: { id: film.id } })}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
