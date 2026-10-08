import { Link } from "@tanstack/react-router"
import { ChevronDown, ChevronUp, Ghost, MoreVertical, Pin } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { Film, Shelf, ShelfOrientation, WishlistItem } from "@/db/schema"
import { formatBadgeClass } from "@/lib/film-helpers"
import { READING_WORDS } from "@/lib/shelf-moves"
import { pileCase, pileOffset } from "@/lib/shelf-pile"
import { isNewSinceArranged } from "@/lib/shelves"
import { cn } from "@/lib/utils"

/**
 * A stacked shelf drawn as the pile it is: each disc a case lying flat,
 * spine out, as long and thick as the real case, first disc on top. The
 * shelf's per-disc menu lives here too, shared with the upright view.
 */

/** Why a disc is flagged new: where it goes since the shelf was arranged. */
export function newDiscHint(
  shelf: Shelf,
  film: Film,
  ordered: ReadonlyArray<Film>,
  position: number,
  orientation: ShelfOrientation
): string | undefined {
  if (!isNewSinceArranged(shelf, film)) return undefined
  const index = position - 1
  const before = index > 0 ? ordered[index - 1] : null
  const after = index < ordered.length - 1 ? ordered[index + 1] : null
  const words = READING_WORDS[orientation]
  return (
    `Added since this shelf was arranged — slot ${position}` +
    (ordered.length > 1
      ? `, between ${before ? before.title : `the ${words.start}`} and ${after ? after.title : `the ${words.end}`}`
      : "")
  )
}

export interface ShelfDiscActions {
  onPin: (filmId: string, shelfId: string) => void
  onUnpin: (filmId: string) => void
  onExclude: (filmId: string, shelfId: string) => void
}

/** Pin a disc to another shelf, unpin it, or take it off this one. */
export function ShelfDiscMenu({
  film,
  shelf,
  shelves,
  triggerClassName,
  onPin,
  onUnpin,
  onExclude,
}: ShelfDiscActions & {
  film: Film
  shelf: Shelf
  shelves: ReadonlyArray<Shelf>
  triggerClassName: string
}) {
  const pinnedHere = shelf.pinned?.includes(film.id) ?? false
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label={`Shelf options for ${film.title}`}
            className={triggerClassName}
          />
        }
      >
        <MoreVertical className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {shelves
          .filter((s) => s.id !== shelf.id)
          .map((s) => (
            <DropdownMenuItem key={s.id} onClick={() => onPin(film.id, s.id)}>
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
  )
}

/** Case colours: blue Blu-ray cases, black DVD and 4K ones, bare steel. */
function caseClass(film: Pick<Film, "format" | "packageType">): string {
  if (film.packageType === "Steelbook") {
    return "bg-linear-to-b from-[#68717c] to-[#3d434b]"
  }
  if (film.format === "Blu-ray") {
    return "bg-linear-to-b from-[#24507d] to-[#173656]"
  }
  return "bg-linear-to-b from-[#2b3037] to-[#191c21]"
}

/** The pile's footprint: centred, as wide as a DVD case can lie. */
export function Pile({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 pt-3 pb-4">
      <div className="mx-auto flex w-full max-w-md flex-col gap-px">
        {children}
      </div>
      {/* The shelf the pile sits on. */}
      <div
        aria-hidden
        className="mx-auto h-1.5 w-full max-w-lg rounded-full bg-secondary shadow-[0_2px_6px_rgba(0,0,0,0.5)]"
      />
    </div>
  )
}

export function PileGroupHeader({ children }: { children: React.ReactNode }) {
  return (
    <p className="pt-2 pb-0.5 text-center text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase first:pt-0">
      {children}
    </p>
  )
}

/** One disc lying in the pile: its spine, with the title running along it. */
export function PileDisc({
  film,
  position,
  shelf,
  shelves,
  ordered,
  overCapacity,
  manualMode,
  onNudge,
  ...actions
}: ShelfDiscActions & {
  film: Film
  position: number
  shelf: Shelf
  shelves: ReadonlyArray<Shelf>
  ordered: ReadonlyArray<Film>
  overCapacity: boolean
  manualMode: boolean
  onNudge: (index: number, delta: -1 | 1) => void
}) {
  const size = pileCase(film)
  const newHint = newDiscHint(shelf, film, ordered, position, "stacked")
  const pinnedHere = shelf.pinned?.includes(film.id) ?? false
  const index = position - 1
  return (
    <div
      title={newHint}
      className={cn(
        "relative mx-auto flex items-stretch rounded-[3px] text-white shadow-[0_1px_1px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,255,255,0.12)] ring-1 ring-black/50",
        caseClass(film),
        newHint && "ring-2 ring-lb-orange",
        overCapacity && "opacity-60"
      )}
      style={{
        height: size.thickness,
        width: `${size.length * 100}%`,
        transform: `translateX(${pileOffset(film.id)}px)`,
      }}
    >
      {/* The format-coloured edge of the case. */}
      <span
        aria-hidden
        className={cn(
          "w-1.5 shrink-0 rounded-l-[3px]",
          formatBadgeClass(film.format)
        )}
      />
      <Link
        to="/films/$filmId"
        params={{ filmId: film.id }}
        className="flex min-w-0 flex-1 items-center gap-2 px-2 text-xs outline-none hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <span
          className={cn(
            "shrink-0 rounded-sm px-1 text-[10px] font-bold tabular-nums",
            overCapacity ? "bg-destructive/90" : "bg-black/35"
          )}
        >
          {position}
        </span>
        <span className="min-w-0 truncate font-semibold tracking-wide">
          {film.title}
        </span>
        {film.year != null && (
          <span className="ml-auto shrink-0 text-[10px] text-white/60 tabular-nums">
            {film.year}
          </span>
        )}
      </Link>
      <span className="flex shrink-0 items-center gap-1 pr-1">
        {newHint && (
          <span className="rounded-sm bg-lb-orange px-1 py-px text-[9px] font-bold text-[#1b0f04] uppercase">
            New
          </span>
        )}
        {pinnedHere && (
          <span title="Pinned to this shelf">
            <Pin aria-label="Pinned" className="size-3 text-white/80" />
          </span>
        )}
        {manualMode ? (
          <>
            <Button
              variant="ghost"
              size="icon-xs"
              className="text-white hover:bg-white/10 hover:text-white"
              aria-label={`Move ${film.title} up`}
              disabled={index === 0}
              onClick={() => onNudge(index, -1)}
            >
              <ChevronUp />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              className="text-white hover:bg-white/10 hover:text-white"
              aria-label={`Move ${film.title} down`}
              disabled={index === ordered.length - 1}
              onClick={() => onNudge(index, 1)}
            >
              <ChevronDown />
            </Button>
          </>
        ) : (
          <ShelfDiscMenu
            film={film}
            shelf={shelf}
            shelves={shelves}
            triggerClassName="flex size-6 items-center justify-center rounded-sm text-white/70 outline-none hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-ring"
            {...actions}
          />
        )}
      </span>
    </div>
  )
}

/** A wishlist ghost in the pile: where a purchase would lie. */
export function PileGhost({ item }: { item: WishlistItem }) {
  const size = pileCase({ format: item.format ?? "Blu-ray" })
  return (
    <div
      title={`${item.title} — on your wishlist; would go here`}
      className="mx-auto flex items-center gap-2 rounded-[3px] border-2 border-dashed border-border px-2 text-xs text-muted-foreground italic opacity-60"
      style={{ height: size.thickness, width: `${size.length * 100}%` }}
    >
      <Ghost className="size-3 shrink-0" />
      <span className="truncate">{item.title}</span>
    </div>
  )
}
