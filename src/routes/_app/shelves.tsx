import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import { Link, createFileRoute } from "@tanstack/react-router"
import {
  ArrowDown,
  ArrowUp,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  Ghost,
  GripVertical,
  MoreVertical,
  Pencil,
  Pin,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react"
import { useMemo, useState } from "react"
import { toast } from "sonner"
import { PosterFrame } from "@/components/film-card"
import { ShelfBuilderDialog } from "@/components/shelf-builder"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import type { Film, Shelf, WishlistItem } from "@/db/schema"
import { filmsQuery, settingsQuery, wishlistQuery } from "@/lib/queries"
import type { ShelfTemplate } from "@/lib/shelves"
import {
  SHELF_TEMPLATES,
  assignFilms,
  assignWishlist,
  buildTemplateShelves,
  ghostInsertionIndex,
  isNewSinceArranged,
  shelfGroupKey,
  shelfOverflow,
} from "@/lib/shelves"
import { saveShelvesFn } from "@/server/settings"
import { cn } from "@/lib/utils"

export const Route = createFileRoute("/_app/shelves")({
  loader: ({ context }) => context.queryClient.ensureQueryData(filmsQuery),
  component: ShelvesPage,
})

/** A film or a wishlist ghost, interleaved in shelf display order. */
type ShelfEntry =
  | { kind: "film"; film: Film; position: number }
  | { kind: "ghost"; item: WishlistItem }

function buildEntries(ordered: Film[], ghosts: WishlistItem[]): ShelfEntry[] {
  const inserts = new Map<number, WishlistItem[]>()
  for (const item of ghosts) {
    const index = ghostInsertionIndex(ordered, item)
    const list = inserts.get(index) ?? []
    list.push(item)
    inserts.set(index, list)
  }
  const entries: ShelfEntry[] = []
  for (let i = 0; i <= ordered.length; i++) {
    for (const item of inserts.get(i) ?? [])
      entries.push({ kind: "ghost", item })
    if (i < ordered.length) {
      entries.push({ kind: "film", film: ordered[i], position: i + 1 })
    }
  }
  return entries
}

function PositionChip({ position, over }: { position: number; over: boolean }) {
  return (
    <span
      className={cn(
        "absolute top-1 left-1 rounded-sm px-1 py-0.5 text-[10px] font-bold tabular-nums backdrop-blur",
        over
          ? "bg-destructive/90 text-white"
          : "bg-background/85 text-foreground"
      )}
    >
      {position}
    </span>
  )
}

function ShelfFilmCard({
  film,
  position,
  shelf,
  shelves,
  ordered,
  overCapacity,
  manualMode,
  onPin,
  onUnpin,
  onExclude,
  onNudge,
}: {
  film: Film
  position: number
  shelf: Shelf
  shelves: Shelf[]
  ordered: Film[]
  overCapacity: boolean
  manualMode: boolean
  onPin: (filmId: string, shelfId: string) => void
  onUnpin: (filmId: string) => void
  onExclude: (filmId: string, shelfId: string) => void
  onNudge: (index: number, delta: -1 | 1) => void
}) {
  const isNew = isNewSinceArranged(shelf, film)
  const pinnedHere = shelf.pinned?.includes(film.id) ?? false
  const index = position - 1
  const before = index > 0 ? ordered[index - 1] : null
  const after = index < ordered.length - 1 ? ordered[index + 1] : null
  const newHint = isNew
    ? `Added since this shelf was arranged — slot ${position}` +
      (ordered.length > 1
        ? `, between ${before ? before.title : "the start"} and ${after ? after.title : "the end"}`
        : "")
    : undefined

  return (
    <div className="group relative w-24 shrink-0" title={newHint}>
      <Link to="/films/$filmId" params={{ filmId: film.id }}>
        <PosterFrame
          coverUrl={film.coverUrl}
          title={film.title}
          className={cn(
            "ring-1 ring-border/60 transition hover:ring-2 hover:ring-lb-green",
            isNew && "ring-2 ring-lb-orange",
            overCapacity && "opacity-60"
          )}
        />
      </Link>
      <PositionChip position={position} over={overCapacity} />
      {isNew && (
        <span className="absolute right-1 bottom-1 rounded-sm bg-lb-orange px-1 py-0.5 text-[9px] font-bold text-[#1b0f04] uppercase">
          New
        </span>
      )}
      {pinnedHere && (
        <span
          title="Pinned to this shelf"
          className="absolute top-1 right-1 rounded-full bg-background/85 p-0.5 backdrop-blur"
        >
          <Pin className="size-3" />
        </span>
      )}
      <p className="mt-1 truncate text-[11px] leading-tight font-medium">
        {film.title}
      </p>
      {manualMode ? (
        <div className="mt-1 flex justify-between">
          <Button
            variant="outline"
            size="icon"
            className="size-6"
            aria-label={`Move ${film.title} left`}
            disabled={index === 0}
            onClick={() => onNudge(index, -1)}
          >
            <ChevronLeft className="size-3.5" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="size-6"
            aria-label={`Move ${film.title} right`}
            disabled={index === ordered.length - 1}
            onClick={() => onNudge(index, 1)}
          >
            <ChevronRight className="size-3.5" />
          </Button>
        </div>
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                aria-label={`Shelf options for ${film.title}`}
                className="absolute -top-2 -right-2 hidden rounded-full border bg-background p-1 shadow-sm group-hover:block focus-visible:block"
              />
            }
          >
            <MoreVertical className="size-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {shelves
              .filter((s) => s.id !== shelf.id)
              .map((s) => (
                <DropdownMenuItem
                  key={s.id}
                  onClick={() => onPin(film.id, s.id)}
                >
                  <Pin className="size-3.5" /> Pin to {s.name}
                </DropdownMenuItem>
              ))}
            {pinnedHere ? (
              <DropdownMenuItem onClick={() => onUnpin(film.id)}>
                Unpin — follow rules again
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onClick={() => onExclude(film.id, shelf.id)}>
                Remove from this shelf
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}

function GhostCard({ item }: { item: WishlistItem }) {
  return (
    <div
      className="w-24 shrink-0 opacity-50"
      title={`${item.title} — on your wishlist; would shelve here`}
    >
      <div className="rounded-md border-2 border-dashed border-border">
        <PosterFrame coverUrl={item.coverUrl} title={item.title} />
      </div>
      <p className="mt-1 flex items-center gap-1 truncate text-[11px] leading-tight text-muted-foreground italic">
        <Ghost className="size-3 shrink-0" /> {item.title}
      </p>
    </div>
  )
}

function ShelvesPage() {
  const { data: films } = useSuspenseQuery(filmsQuery)
  const { data: settings } = useQuery(settingsQuery)
  const { data: wishlist } = useQuery(wishlistQuery)
  const queryClient = useQueryClient()

  const shelves = useMemo(() => settings?.shelves ?? [], [settings?.shelves])

  const saveShelves = useMutation({
    mutationFn: (next: Shelf[]) => saveShelvesFn({ data: { shelves: next } }),
    // Optimistic — manual-order nudges and drags should feel instant.
    onMutate: async (next) => {
      await queryClient.cancelQueries({ queryKey: ["settings"] })
      const prev = queryClient.getQueryData(settingsQuery.queryKey)
      queryClient.setQueryData(settingsQuery.queryKey, (old) =>
        old ? { ...old, shelves: next } : old
      )
      return { prev }
    },
    onError: (_error, _next, context) => {
      queryClient.setQueryData(settingsQuery.queryKey, context?.prev)
      toast.error("Could not save shelves")
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["settings"] }),
  })
  const update = (next: Shelf[]) => saveShelves.mutate(next)

  const [builderOpen, setBuilderOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [manualShelfId, setManualShelfId] = useState<string | null>(null)
  const [showGhosts, setShowGhosts] = useState(false)
  const [draggingId, setDraggingId] = useState<string | null>(null)

  const assignment = useMemo(
    () => assignFilms(films, shelves),
    [films, shelves]
  )
  const ghostsByShelf = useMemo(
    () =>
      showGhosts && wishlist
        ? assignWishlist(wishlist, shelves)
        : new Map<string, WishlistItem[]>(),
    [showGhosts, wishlist, shelves]
  )
  const unplacedGhosts =
    (wishlist?.length ?? 0) -
    [...ghostsByShelf.values()].reduce((sum, items) => sum + items.length, 0)

  const editing = shelves.find((s) => s.id === editingId) ?? null

  // ---- Shelf-level actions --------------------------------------------
  const openNewShelf = () => {
    setEditingId(null)
    setBuilderOpen(true)
  }
  const openEdit = (id: string) => {
    setEditingId(id)
    setBuilderOpen(true)
  }
  const onSaveShelf = (shelf: Shelf) => {
    const exists = shelves.some((s) => s.id === shelf.id)
    update(
      exists
        ? shelves.map((s) => (s.id === shelf.id ? shelf : s))
        : [...shelves, shelf]
    )
    toast.success(`Shelf “${shelf.name}” saved`)
  }
  const deleteShelf = (id: string) => {
    const shelf = shelves.find((s) => s.id === id)
    update(shelves.filter((s) => s.id !== id))
    if (shelf) toast.success(`Shelf “${shelf.name}” deleted`)
  }
  const moveShelf = (id: string, delta: -1 | 1) => {
    const index = shelves.findIndex((s) => s.id === id)
    const target = index + delta
    if (target < 0 || target >= shelves.length) return
    const next = [...shelves]
    ;[next[index], next[target]] = [next[target], next[index]]
    update(next)
  }
  const dropShelf = (targetId: string) => {
    if (!draggingId || draggingId === targetId) return
    const next = shelves.filter((s) => s.id !== draggingId)
    const dragged = shelves.find((s) => s.id === draggingId)!
    next.splice(
      next.findIndex((s) => s.id === targetId),
      0,
      dragged
    )
    update(next)
  }
  const markArranged = (ids: string[]) => {
    const now = new Date().toISOString()
    update(
      shelves.map((s) => (ids.includes(s.id) ? { ...s, arrangedAt: now } : s))
    )
    toast.success(
      ids.length === 1 ? "Shelf marked arranged" : "All shelves marked arranged"
    )
  }
  const applyTemplate = (template: ShelfTemplate) => {
    if (
      shelves.length > 0 &&
      !window.confirm("Replace your current shelves with this template?")
    ) {
      return
    }
    update(buildTemplateShelves(template, films))
    toast.success("Shelves created — tweak the rules to taste")
  }

  // ---- Film-level actions ---------------------------------------------
  const pinTo = (filmId: string, shelfId: string) =>
    update(
      shelves.map((s) => ({
        ...s,
        pinned:
          s.id === shelfId
            ? [...(s.pinned ?? []).filter((id) => id !== filmId), filmId]
            : s.pinned?.filter((id) => id !== filmId),
        excluded:
          s.id === shelfId
            ? s.excluded?.filter((id) => id !== filmId)
            : s.excluded,
      }))
    )
  const unpin = (filmId: string) =>
    update(
      shelves.map((s) => ({
        ...s,
        pinned: s.pinned?.filter((id) => id !== filmId),
      }))
    )
  const excludeFrom = (filmId: string, shelfId: string) =>
    update(
      shelves.map((s) =>
        s.id === shelfId
          ? {
              ...s,
              excluded: [...(s.excluded ?? []), filmId],
              pinned: s.pinned?.filter((id) => id !== filmId),
            }
          : s
      )
    )
  const nudge = (shelfId: string, index: number, delta: -1 | 1) => {
    const ordered = assignment.byShelf.get(shelfId)
    if (!ordered) return
    const ids = ordered.map((f) => f.id)
    const target = index + delta
    if (target < 0 || target >= ids.length) return
    ;[ids[index], ids[target]] = [ids[target], ids[index]]
    update(
      shelves.map((s) => (s.id === shelfId ? { ...s, manualOrder: ids } : s))
    )
  }
  const clearManualOrder = (shelfId: string) =>
    update(
      shelves.map((s) =>
        s.id === shelfId ? { ...s, manualOrder: undefined } : s
      )
    )

  // ---- Empty state ------------------------------------------------------
  if (shelves.length === 0) {
    return (
      <div className="space-y-6">
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No shelves yet</EmptyTitle>
            <EmptyDescription>
              Shelves are a digital twin of your physical wall: every film lands
              on exactly one shelf, top shelf wins. Start from a template or
              build your own.
            </EmptyDescription>
          </EmptyHeader>
          <div className="grid gap-3 sm:grid-cols-3">
            {SHELF_TEMPLATES.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => applyTemplate(t.key)}
                className="rounded-lg border bg-card p-4 text-left transition-colors hover:border-lb-green"
              >
                <p className="flex items-center gap-1.5 text-sm font-semibold">
                  <Sparkles className="size-3.5 text-lb-green" /> {t.label}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t.description}
                </p>
              </button>
            ))}
          </div>
          <Button variant="outline" className="gap-2" onClick={openNewShelf}>
            <Plus className="size-4" /> New custom shelf
          </Button>
        </Empty>
        <ShelfBuilderDialog
          open={builderOpen}
          onOpenChange={setBuilderOpen}
          films={films}
          shelves={shelves}
          editing={editing}
          onSave={onSaveShelf}
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Shelves</h1>
          <p className="text-sm text-muted-foreground">
            {shelves.length} shel{shelves.length === 1 ? "f" : "ves"} · films
            land on the first shelf they match, top to bottom
            {assignment.unshelved.length > 0 && (
              <>
                {" "}
                ·{" "}
                <span className="text-lb-orange">
                  {assignment.unshelved.length} unshelved
                </span>
              </>
            )}
            {showGhosts && unplacedGhosts > 0 && (
              <>
                {" "}
                · {unplacedGhosts} wishlist item
                {unplacedGhosts === 1 ? "" : "s"} can't be placed — a ghost
                needs a format and a shelf whose rules use only format, type, or
                decade
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={showGhosts ? "secondary" : "outline"}
            className="gap-2"
            aria-pressed={showGhosts}
            onClick={() => setShowGhosts((v) => !v)}
          >
            <Ghost className="size-4" /> Wishlist ghosts
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="outline" className="gap-2" />}
            >
              <Sparkles className="size-4" /> Templates
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {SHELF_TEMPLATES.map((t) => (
                <DropdownMenuItem
                  key={t.key}
                  onClick={() => applyTemplate(t.key)}
                >
                  <div>
                    <p>{t.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {t.description}
                    </p>
                  </div>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => markArranged(shelves.map((s) => s.id))}
          >
            <CheckCheck className="size-4" /> Mark all arranged
          </Button>
          <Button className="gap-2" onClick={openNewShelf}>
            <Plus className="size-4" /> New shelf
          </Button>
        </div>
      </div>

      {shelves.map((shelf, shelfIndex) => {
        const ordered = assignment.byShelf.get(shelf.id) ?? []
        const overflow = shelfOverflow(shelf, ordered)
        const ghosts = ghostsByShelf.get(shelf.id) ?? []
        const entries = buildEntries(ordered, ghosts)
        const manualMode = manualShelfId === shelf.id
        const newCount = ordered.filter((f) =>
          isNewSinceArranged(shelf, f)
        ).length

        // Contiguous groupBy segments — a header above each run.
        let lastGroup: string | null | undefined
        return (
          <section
            key={shelf.id}
            aria-label={`Shelf: ${shelf.name}`}
            className={cn(
              "rounded-lg border bg-card transition-opacity",
              draggingId === shelf.id && "opacity-50"
            )}
            onDragOver={(e) => draggingId && e.preventDefault()}
            onDrop={() => dropShelf(shelf.id)}
          >
            <header className="flex flex-wrap items-center gap-2 border-b border-border/60 px-3 py-2">
              <span
                draggable
                role="button"
                aria-label={`Drag to reorder ${shelf.name}`}
                onDragStart={() => setDraggingId(shelf.id)}
                onDragEnd={() => setDraggingId(null)}
                className="cursor-grab text-muted-foreground hover:text-foreground active:cursor-grabbing"
              >
                <GripVertical className="size-4" />
              </span>
              <h2 className="text-sm font-bold tracking-tight">{shelf.name}</h2>
              <span className="text-xs text-muted-foreground tabular-nums">
                {shelf.capacity != null
                  ? `${ordered.length} / ${shelf.capacity}`
                  : ordered.length}
                {ghosts.length > 0 &&
                  ` · ${ghosts.length} ghost${ghosts.length === 1 ? "" : "s"}`}
              </span>
              {overflow.length > 0 && (
                <span
                  className="text-xs font-semibold text-destructive"
                  title={`Suggested spill to the next shelf: ${overflow
                    .map((f) => f.title)
                    .join(", ")}`}
                >
                  over by {overflow.length}
                </span>
              )}
              {newCount > 0 && (
                <span className="rounded-sm bg-lb-orange px-1.5 py-0.5 text-[10px] font-bold text-[#1b0f04] uppercase">
                  {newCount} new
                </span>
              )}
              {shelf.manualOrder?.length ? (
                <button
                  type="button"
                  className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                  onClick={() => clearManualOrder(shelf.id)}
                >
                  hand-arranged — reset
                </button>
              ) : null}
              <span className="ml-auto flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Move ${shelf.name} up`}
                  disabled={shelfIndex === 0}
                  onClick={() => moveShelf(shelf.id, -1)}
                >
                  <ArrowUp className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Move ${shelf.name} down`}
                  disabled={shelfIndex === shelves.length - 1}
                  onClick={() => moveShelf(shelf.id, 1)}
                >
                  <ArrowDown className="size-4" />
                </Button>
                <Button
                  variant={manualMode ? "secondary" : "ghost"}
                  size="sm"
                  aria-pressed={manualMode}
                  onClick={() => setManualShelfId(manualMode ? null : shelf.id)}
                >
                  {manualMode ? "Done arranging" : "Arrange"}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Mark ${shelf.name} arranged`}
                  title="Mark arranged — clears the NEW flags"
                  onClick={() => markArranged([shelf.id])}
                >
                  <CheckCheck className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Edit ${shelf.name}`}
                  onClick={() => openEdit(shelf.id)}
                >
                  <Pencil className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Delete ${shelf.name}`}
                  onClick={() => deleteShelf(shelf.id)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </span>
            </header>
            {entries.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                Nothing matches this shelf yet.
              </p>
            ) : (
              <div className="flex flex-wrap items-end gap-3 p-3">
                {entries.map((entry) => {
                  const group =
                    entry.kind === "film" && shelf.groupBy
                      ? shelfGroupKey(entry.film, shelf)
                      : undefined
                  const groupHeader =
                    group !== undefined && group !== lastGroup ? (
                      <div className="w-full pt-1 first:pt-0">
                        <p className="text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                          {group ?? "Other"}
                        </p>
                      </div>
                    ) : null
                  if (group !== undefined) lastGroup = group
                  return (
                    <span
                      key={
                        entry.kind === "film" ? entry.film.id : entry.item.id
                      }
                      className="contents"
                    >
                      {groupHeader}
                      {entry.kind === "film" ? (
                        <ShelfFilmCard
                          film={entry.film}
                          position={entry.position}
                          shelf={shelf}
                          shelves={shelves}
                          ordered={ordered}
                          overCapacity={
                            shelf.capacity != null &&
                            entry.position > shelf.capacity
                          }
                          manualMode={manualMode}
                          onPin={pinTo}
                          onUnpin={unpin}
                          onExclude={excludeFrom}
                          onNudge={(index, delta) =>
                            nudge(shelf.id, index, delta)
                          }
                        />
                      ) : (
                        <GhostCard item={entry.item} />
                      )}
                    </span>
                  )
                })}
              </div>
            )}
          </section>
        )
      })}

      {assignment.unshelved.length > 0 && (
        <section
          aria-label="Unshelved films"
          className="rounded-lg border-2 border-dashed"
        >
          <header className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
            <h2 className="text-sm font-bold tracking-tight">Unshelved</h2>
            <span className="text-xs text-muted-foreground">
              no shelf claims these — add a rule, a catch-all shelf, or pin them
              somewhere
            </span>
          </header>
          <div className="flex flex-wrap items-end gap-3 p-3">
            {assignment.unshelved.map((film) => (
              <div key={film.id} className="group relative w-24 shrink-0">
                <Link to="/films/$filmId" params={{ filmId: film.id }}>
                  <PosterFrame
                    coverUrl={film.coverUrl}
                    title={film.title}
                    className="ring-1 ring-border/60 transition hover:ring-2 hover:ring-lb-green"
                  />
                </Link>
                <p className="mt-1 truncate text-[11px] leading-tight font-medium">
                  {film.title}
                </p>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <button
                        type="button"
                        aria-label={`Shelve ${film.title}`}
                        className="absolute -top-2 -right-2 hidden rounded-full border bg-background p-1 shadow-sm group-hover:block focus-visible:block"
                      />
                    }
                  >
                    <MoreVertical className="size-3.5" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {shelves.map((s) => (
                      <DropdownMenuItem
                        key={s.id}
                        onClick={() => pinTo(film.id, s.id)}
                      >
                        <Pin className="size-3.5" /> Pin to {s.name}
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      render={
                        <Link to="/films/$filmId" params={{ filmId: film.id }}>
                          Open film
                        </Link>
                      }
                    />
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))}
          </div>
        </section>
      )}

      <ShelfBuilderDialog
        open={builderOpen}
        onOpenChange={setBuilderOpen}
        films={films}
        shelves={shelves}
        editing={editing}
        onSave={onSaveShelf}
      />
    </div>
  )
}
