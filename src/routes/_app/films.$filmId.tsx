import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { Eye, EyeOff, Pencil, RotateCcw, Trash2 } from "lucide-react"
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
import { formatRuntime, isWatched, resolutionOf } from "@/lib/film-helpers"
import { filmQuery } from "@/lib/queries"
import {
  deleteFilmFn,
  setWatchedOverrideFn,
  updateFilmFn,
} from "@/server/films"

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
    onSuccess: async () => {
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
              <span className="font-medium text-foreground">
                {film.director}
              </span>
            </p>
          )}
          <div className="flex flex-wrap gap-1.5 pt-1">
            <Badge variant="secondary">{film.format}</Badge>
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
          </div>
        </div>

        {/* Watched control */}
        <div className="rounded-lg border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Watched tracking</p>
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
                <div
                  key={member.id}
                  className="bg-card flex items-center gap-2 rounded-full border py-1 pr-3 pl-1"
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
                </div>
              ))}
            </div>
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
