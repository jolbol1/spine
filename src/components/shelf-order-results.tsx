import { Link } from "@tanstack/react-router"
import {
  ArrowLeftRight,
  ArrowUpDown,
  Check,
  CheckCheck,
  CircleDashed,
  CornerUpRight,
  Loader2,
  Plus,
} from "lucide-react"
import { filmLabel } from "@/components/duplicate-warning"
import { ResultSection, SpineRow } from "@/components/shelf-spine-row"
import { Button } from "@/components/ui/button"
import type { Film, ShelfOrientation } from "@/db/schema"
import { addedSince } from "@/lib/shelf-check"
import {
  READING_WORDS,
  isInOrder,
  moveSentence,
  orderCounts,
  orderSummary,
} from "@/lib/shelf-moves"
import type { Phrase } from "@/lib/shelf-moves"
import type {
  PlacedSpine,
  ShelfOrderCheck,
  SpinePlacement,
} from "@/lib/shelf-order"
import { pileCase, pileOffset } from "@/lib/shelf-pile"
import { cn } from "@/lib/utils"

const PLACEMENTS: Record<SpinePlacement, { label: string; className: string }> =
  {
    "in-order": {
      label: "In place",
      className: "border-lb-green/50 bg-lb-green/10",
    },
    "out-of-order": {
      label: "Move",
      className: "border-lb-orange bg-lb-orange/20",
    },
    "other-shelf": {
      label: "Other shelf",
      className: "border-lb-blue bg-lb-blue/15",
    },
    unshelved: {
      label: "No shelf",
      className: "border-dashed border-lb-blue/70 bg-lb-blue/5",
    },
    "not-catalogued": {
      label: "Not catalogued",
      className:
        "border-dashed border-muted-foreground/50 text-muted-foreground",
    },
  }

function PlacementIcon({
  placement,
  orientation,
  className,
}: {
  placement: SpinePlacement
  orientation: ShelfOrientation
  className?: string
}) {
  const Icon = {
    "in-order": Check,
    "out-of-order": orientation === "stacked" ? ArrowUpDown : ArrowLeftRight,
    "other-shelf": CornerUpRight,
    unshelved: CircleDashed,
    "not-catalogued": Plus,
  }[placement]
  return <Icon aria-hidden className={cn("size-3.5 shrink-0", className)} />
}

const titleOf = (placed: PlacedSpine) =>
  placed.film?.title ?? placed.spine.title

/** The discs as photographed, in reading order, each marked. */
function PhotographedStrip({
  spines,
  orientation,
}: {
  spines: ReadonlyArray<PlacedSpine>
  orientation: ShelfOrientation
}) {
  const used = new Set(spines.map((s) => s.placement))
  return (
    <div className="space-y-2">
      <div
        role="region"
        aria-label="The discs as photographed"
        tabIndex={0}
        className={cn(
          "rounded-lg border bg-card p-3 outline-none focus-visible:ring-2 focus-visible:ring-ring",
          orientation === "upright" && "overflow-x-auto"
        )}
      >
        {orientation === "upright" ? (
          <ol className="flex w-max items-end gap-1">
            {spines.map((placed, index) => (
              <li
                key={index}
                title={`${titleOf(placed)} — ${PLACEMENTS[placed.placement].label}`}
                className={cn(
                  "flex h-32 w-8 flex-col items-center gap-1 rounded-sm border px-0.5 py-1.5",
                  PLACEMENTS[placed.placement].className
                )}
              >
                <PlacementIcon
                  placement={placed.placement}
                  orientation={orientation}
                />
                <span className="min-h-0 flex-1 rotate-180 truncate text-[11px] leading-none font-medium [writing-mode:vertical-rl]">
                  {titleOf(placed)}
                </span>
                <span className="sr-only">
                  {" "}
                  — {PLACEMENTS[placed.placement].label}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <ol className="mx-auto flex max-w-md flex-col gap-px">
            {spines.map((placed, index) => {
              const size = pileCase(
                placed.film ?? { format: placed.spine.format ?? "Blu-ray" }
              )
              return (
                <li
                  key={index}
                  title={`${titleOf(placed)} — ${PLACEMENTS[placed.placement].label}`}
                  className={cn(
                    "mx-auto flex items-center gap-2 rounded-sm border px-2 text-xs",
                    PLACEMENTS[placed.placement].className
                  )}
                  style={{
                    height: size.thickness,
                    width: `${size.length * 100}%`,
                    transform: `translateX(${pileOffset(placed.film?.id ?? placed.spine.text)}px)`,
                  }}
                >
                  <PlacementIcon
                    placement={placed.placement}
                    orientation={orientation}
                  />
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {titleOf(placed)}
                  </span>
                  <span className="sr-only">
                    {" "}
                    — {PLACEMENTS[placed.placement].label}
                  </span>
                </li>
              )
            })}
          </ol>
        )}
      </div>
      <ul
        aria-label="Key"
        className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground"
      >
        {(Object.keys(PLACEMENTS) as Array<SpinePlacement>)
          .filter((placement) => used.has(placement))
          .map((placement) => (
            <li key={placement} className="flex items-center gap-1.5">
              <span
                className={cn(
                  "flex size-4 items-center justify-center rounded-sm border text-foreground",
                  PLACEMENTS[placement].className
                )}
              >
                <PlacementIcon
                  placement={placement}
                  orientation={orientation}
                  className="size-3"
                />
              </span>
              {PLACEMENTS[placement].label}
            </li>
          ))}
      </ul>
    </div>
  )
}

/** A sentence with the discs' titles emphasised. */
function Sentence({ phrases }: { phrases: ReadonlyArray<Phrase> }) {
  return (
    <>
      {phrases.map((phrase, index) =>
        "text" in phrase ? (
          <span key={index}>{phrase.text}</span>
        ) : (
          <em key={index} className="font-semibold">
            {phrase.film.title}
          </em>
        )
      )}
    </>
  )
}

/**
 * A shelf order check, in words: how many discs need moving and where each
 * goes, what belongs on another shelf, what isn't catalogued, and what the
 * shelf should hold but the photos don't show.
 */
export function ShelfOrderResults({
  check,
  films,
  orientation,
  markArranged,
}: {
  check: ShelfOrderCheck
  films: ReadonlyArray<Film>
  orientation: ShelfOrientation
  /** Offered once everything photographed is in order. */
  markArranged?: { pending: boolean; done: boolean; onMark: () => void }
}) {
  const counts = orderCounts(check)
  const inOrder = isInOrder(counts)
  const moves = check.spines.filter((s) => s.placement === "out-of-order")
  const elsewhere = check.spines.filter(
    (s) => s.placement === "other-shelf" || s.placement === "unshelved"
  )
  const uncatalogued = check.spines.filter(
    (s) => s.placement === "not-catalogued"
  )
  const extras = [
    counts.otherShelf + counts.unshelved > 0 &&
      `${counts.otherShelf + counts.unshelved} on the wrong shelf`,
    counts.notCatalogued > 0 && `${counts.notCatalogued} not catalogued`,
    check.absent.length > 0 && `${check.absent.length} not photographed`,
  ].filter(Boolean)

  return (
    <div className="space-y-6">
      <div
        className={cn(
          "flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4",
          counts.moves > 0
            ? "border-lb-orange/40 bg-lb-orange/10"
            : inOrder
              ? "border-lb-green/40 bg-lb-green/10"
              : "bg-card"
        )}
      >
        <div>
          <p className="text-lg font-bold tracking-tight">
            {orderSummary(counts)}
          </p>
          <p className="text-xs text-muted-foreground">
            {check.spines.length} disc{check.spines.length === 1 ? "" : "s"}{" "}
            photographed, read {READING_WORDS[orientation].direction}
            {extras.length > 0 && ` · ${extras.join(" · ")}`}
          </p>
        </div>
        {inOrder &&
          markArranged &&
          (markArranged.done ? (
            <p className="flex items-center gap-1.5 text-sm font-medium text-lb-green">
              <CheckCheck className="size-4" /> Marked arranged
            </p>
          ) : (
            <Button
              className="gap-2"
              disabled={markArranged.pending}
              onClick={markArranged.onMark}
            >
              {markArranged.pending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <CheckCheck className="size-4" />
              )}
              Mark arranged
            </Button>
          ))}
      </div>

      <PhotographedStrip spines={check.spines} orientation={orientation} />

      {moves.length > 0 && (
        <ResultSection title="Moves" count={moves.length}>
          <ol className="space-y-2">
            {moves.map((placed, index) => (
              <li
                key={index}
                className="flex items-start gap-2.5 rounded-lg border bg-card p-3 text-sm"
              >
                <PlacementIcon
                  placement="out-of-order"
                  orientation={orientation}
                  className="mt-0.5 size-4 text-lb-orange"
                />
                <p>
                  <Sentence phrases={moveSentence(placed, orientation) ?? []} />
                </p>
              </li>
            ))}
          </ol>
        </ResultSection>
      )}

      {elsewhere.length > 0 && (
        <ResultSection
          title="Belongs on another shelf"
          count={elsewhere.length}
        >
          <ul className="space-y-2">
            {elsewhere.map((placed, index) => (
              <li
                key={index}
                className="flex items-center gap-2.5 rounded-lg border bg-card p-3 text-sm"
              >
                <PlacementIcon
                  placement={placed.placement}
                  orientation={orientation}
                  className="size-4 text-lb-blue"
                />
                <p>
                  <em className="font-semibold">{titleOf(placed)}</em> →{" "}
                  {placed.belongsOn ? (
                    placed.belongsOn.name
                  ) : (
                    <span className="text-muted-foreground">
                      no shelf yet — pin it or add a rule
                    </span>
                  )}
                </p>
              </li>
            ))}
          </ul>
        </ResultSection>
      )}

      {uncatalogued.length > 0 && (
        <ResultSection title="Not catalogued" count={uncatalogued.length}>
          <ul className="space-y-2">
            {uncatalogued.map((placed, index) => (
              <SpineRow
                key={index}
                spine={placed.spine}
                added={addedSince(placed.spine, films)}
                checkShelf={check.shelf.id}
              />
            ))}
          </ul>
        </ResultSection>
      )}

      {check.absent.length > 0 && (
        <ResultSection
          title="Expected here but not in the photo"
          count={check.absent.length}
        >
          <p className="text-xs text-muted-foreground">
            The shelf's order puts these among the discs photographed — moved,
            lent, or misfiled?
          </p>
          <ul className="flex flex-wrap gap-2">
            {check.absent.map((film) => (
              <li key={film.id}>
                <Link
                  to="/films/$filmId"
                  params={{ filmId: film.id }}
                  className="block rounded-md border bg-card px-2.5 py-1.5 text-sm transition-colors outline-none hover:border-lb-green focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {filmLabel(film)}
                </Link>
              </li>
            ))}
          </ul>
        </ResultSection>
      )}
    </div>
  )
}
