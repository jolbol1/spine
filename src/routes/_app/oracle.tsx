import { useSuspenseQuery } from "@tanstack/react-query"
import { Link, createFileRoute } from "@tanstack/react-router"
import { Clock, Sparkles } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { PosterFrame } from "@/components/film-card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import type { Film } from "@/db/schema"
import { formatRuntime, isWatched } from "@/lib/film-helpers"
import { filmsQuery } from "@/lib/queries"

export const Route = createFileRoute("/_app/oracle")({
  loader: ({ context }) => context.queryClient.ensureQueryData(filmsQuery),
  component: OraclePage,
})

const TIME_OPTIONS = [
  { value: "any", label: "Any length" },
  { value: "90", label: "≤ 1h 30m" },
  { value: "105", label: "≤ 1h 45m" },
  { value: "120", label: "≤ 2h" },
  { value: "150", label: "≤ 2h 30m" },
  { value: "180", label: "≤ 3h" },
  { value: "240", label: "≤ 4h" },
] as const

function OraclePage() {
  const { data: films } = useSuspenseQuery(filmsQuery)

  const [unwatchedOnly, setUnwatchedOnly] = useState(true)
  const [format, setFormat] = useState<string>("any")
  const [timeLimit, setTimeLimit] = useState<string>("any")

  const [pick, setPick] = useState<Film | null>(null)
  const [spinning, setSpinning] = useState(false)
  const [flicker, setFlicker] = useState<Film | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [])

  const candidates = useMemo(() => {
    let list = films
    if (unwatchedOnly) list = list.filter((f) => !isWatched(f))
    if (format !== "any") list = list.filter((f) => f.format === format)
    if (timeLimit !== "any") {
      const limit = Number(timeLimit)
      // Only films with a known runtime at or under the limit qualify.
      list = list.filter(
        (f) => f.runtimeMinutes != null && f.runtimeMinutes <= limit
      )
    }
    return list
  }, [films, unwatchedOnly, format, timeLimit])

  function consult() {
    if (candidates.length === 0) return
    setPick(null)
    setSpinning(true)
    let ticks = 0
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = setInterval(() => {
      ticks++
      setFlicker(candidates[Math.floor(Math.random() * candidates.length)])
      if (ticks >= 14) {
        clearInterval(timerRef.current!)
        timerRef.current = null
        const chosen = candidates[Math.floor(Math.random() * candidates.length)]
        setFlicker(null)
        setPick(chosen)
        setSpinning(false)
      }
    }, 110)
  }

  if (films.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>The Oracle sees nothing</EmptyTitle>
          <EmptyDescription>
            <Link to="/add" className="text-lb-blue hover:underline">
              Add films to your collection
            </Link>{" "}
            and the Oracle will choose among them.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  const shown = flicker ?? pick

  return (
    <div className="mx-auto max-w-2xl space-y-8 text-center">
      <div className="space-y-2">
        <p className="text-xs font-semibold tracking-[0.3em] text-lb-orange uppercase">
          The Oracle
        </p>
        <h1 className="text-3xl font-bold tracking-tight">
          Can't decide? Don't.
        </h1>
        <p className="text-sm text-muted-foreground">
          Tell the Oracle how much time you have. It answers from your own
          shelf.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3">
        <label className="flex items-center gap-2 text-sm">
          <Switch
            checked={unwatchedOnly}
            onCheckedChange={(checked) => setUnwatchedOnly(checked === true)}
          />
          Unwatched only
        </label>
        <Select
          value={format}
          items={{
            any: "Any format",
            "4K UHD": "4K UHD",
            "Blu-ray": "Blu-ray",
            DVD: "DVD",
          }}
          onValueChange={(v) => setFormat(v as string)}
        >
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Any format</SelectItem>
            <SelectItem value="4K UHD">4K UHD</SelectItem>
            <SelectItem value="Blu-ray">Blu-ray</SelectItem>
            <SelectItem value="DVD">DVD</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2">
          <Clock className="size-4 text-muted-foreground" />
          <Select
            value={timeLimit}
            items={Object.fromEntries(
              TIME_OPTIONS.map((option) => [option.value, option.label])
            )}
            onValueChange={(v) => setTimeLimit(v as string)}
          >
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIME_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        {candidates.length} film{candidates.length === 1 ? "" : "s"} fit the
        bill
        {timeLimit !== "any" &&
          " (films without a recorded runtime are left out)"}
      </p>

      <Button
        size="lg"
        onClick={consult}
        disabled={spinning || candidates.length === 0}
        className="gap-2 bg-lb-orange text-[#1b0e00] hover:bg-lb-orange/85"
      >
        <Sparkles className="size-4" />
        {spinning
          ? "Consulting…"
          : pick
            ? "Consult again"
            : "Consult the Oracle"}
      </Button>

      {candidates.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Nothing fits these constraints — loosen the runtime limit or include
          watched films.
        </p>
      )}

      {shown && (
        <div
          className={
            spinning
              ? "opacity-70 transition-opacity"
              : "animate-in duration-300 zoom-in-95 fade-in"
          }
        >
          <div className="mx-auto w-48">
            <PosterFrame
              coverUrl={shown.coverUrl}
              title={shown.title}
              className={
                spinning
                  ? ""
                  : "shadow-2xl ring-2 shadow-lb-orange/20 ring-lb-orange"
              }
            />
          </div>
          {!spinning && pick && (
            <div className="mt-4 space-y-2">
              <h2 className="text-xl font-bold">
                <Link
                  to="/films/$filmId"
                  params={{ filmId: pick.id }}
                  className="transition-colors hover:text-lb-orange"
                >
                  {pick.title}
                </Link>
              </h2>
              <div className="flex flex-wrap items-center justify-center gap-1.5">
                {pick.year && <Badge variant="secondary">{pick.year}</Badge>}
                {pick.director && (
                  <Badge variant="secondary">{pick.director}</Badge>
                )}
                <Badge variant="secondary">{pick.format}</Badge>
                {pick.runtimeMinutes && (
                  <Badge className="bg-lb-orange text-[#1b0e00]">
                    {formatRuntime(pick.runtimeMinutes)}
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                The Oracle has spoken. Tonight you watch this.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
