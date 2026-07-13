import { useSuspenseQuery } from "@tanstack/react-query"
import { Link, createFileRoute } from "@tanstack/react-router"
import { useMemo } from "react"
import { Bar, BarChart, CartesianGrid, Pie, PieChart, XAxis, YAxis } from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import type { ChartConfig } from "@/components/ui/chart"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import type { Film } from "@/db/schema"
import {
  directorsOf,
  formatPrice,
  formatRuntime,
  formatUsdCompact,
  isWatched,
  resolutionOf,
} from "@/lib/film-helpers"
import { filmsQuery } from "@/lib/queries"
import { cn } from "@/lib/utils"

export const Route = createFileRoute("/_app/stats")({
  loader: ({ context }) => context.queryClient.ensureQueryData(filmsQuery),
  component: StatsPage,
})

const ACCENTS = [
  "bg-lb-green",
  "bg-lb-blue",
  "bg-lb-orange",
  "bg-chart-4",
  "bg-chart-5",
]

function tally<T>(
  items: T[],
  key: (item: T) => string | null
): Array<[string, number]> {
  const counts = new Map<string, number>()
  for (const item of items) {
    const k = key(item)
    if (k == null) continue
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])
}

function StatCard({
  label,
  value,
  detail,
  accent,
}: {
  label: string
  value: React.ReactNode
  detail?: string
  accent?: string
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">
          {label}
        </p>
        <p className={cn("mt-1 text-2xl font-bold tabular-nums", accent)}>
          {value}
        </p>
        {detail && (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {detail}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function BreakdownCard({
  title,
  rows,
  max = 8,
  personLinks = false,
}: {
  title: string
  rows: Array<[string, number]>
  max?: number
  /** Link each row's name to its person page. */
  personLinks?: boolean
}) {
  const top = rows.slice(0, max)
  const total = rows.reduce((sum, [, n]) => sum + n, 0)
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {top.length === 0 && (
          <p className="text-sm text-muted-foreground">No data yet.</p>
        )}
        {top.map(([name, count], i) => (
          <div key={name} className="space-y-1">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              {personLinks ? (
                <Link
                  to="/people/$person"
                  params={{ person: name }}
                  className="truncate transition-colors hover:text-lb-green"
                >
                  {name}
                </Link>
              ) : (
                <span className="truncate">{name}</span>
              )}
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {count}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
              <div
                className={cn(
                  "h-full rounded-full",
                  ACCENTS[i % ACCENTS.length]
                )}
                style={{ width: `${Math.max(4, (count / total) * 100)}%` }}
              />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

interface RankedRow {
  id: string
  name: string
  value: number
  display: string
  detail?: string
}

/** Ranked film list with value bars — top box office, budgets, ROI, … */
function RankedCard({ title, rows }: { title: string; rows: RankedRow[] }) {
  const max = rows[0]?.value ?? 1
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No data yet — run the TMDB details sync in Settings.
          </p>
        )}
        {rows.map((row, i) => (
          <div key={row.id} className="space-y-1">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <Link
                to="/films/$filmId"
                params={{ filmId: row.id }}
                className="truncate transition-colors hover:text-lb-green"
              >
                {row.name}
              </Link>
              <span
                className="shrink-0 text-xs text-muted-foreground tabular-nums"
                title={row.detail}
              >
                {row.detail ? `${row.display} · ${row.detail}` : row.display}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
              <div
                className={cn(
                  "h-full rounded-full",
                  ACCENTS[i % ACCENTS.length],
                )}
                style={{ width: `${Math.max(4, (row.value / max) * 100)}%` }}
              />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

/** BBFC first, MPAA after — anything unknown lands at the end. */
const CERT_ORDER = [
  "U",
  "PG",
  "12",
  "12A",
  "15",
  "18",
  "R18",
  "G",
  "PG-13",
  "R",
  "NC-17",
]

function AgeRatingChart({ rows }: { rows: Array<[string, number]> }) {
  const data = rows.map(([rating, count]) => ({ rating, count }))
  const config = {
    count: { label: "Titles", color: "var(--chart-3)" },
  } satisfies ChartConfig
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Age rating</CardTitle>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No data yet — run the TMDB details sync in Settings.
          </p>
        ) : (
          <ChartContainer config={config} className="h-56 w-full">
            <BarChart accessibilityLayer data={data}>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="rating"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
              />
              <YAxis
                allowDecimals={false}
                tickLine={false}
                axisLine={false}
                width={28}
              />
              <ChartTooltip
                cursor={false}
                content={<ChartTooltipContent hideLabel />}
              />
              <Bar
                dataKey="count"
                fill="var(--color-count)"
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  )
}

const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
]

function DecadeChart({ rows }: { rows: Array<[string, number]> }) {
  const data = rows.map(([decade, count]) => ({ decade, count }))
  const config = {
    count: { label: "Titles", color: "var(--chart-1)" },
  } satisfies ChartConfig
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Titles by decade</CardTitle>
      </CardHeader>
      <CardContent>
        <ChartContainer config={config} className="h-64 w-full">
          <BarChart accessibilityLayer data={data}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="decade"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
            />
            <YAxis
              allowDecimals={false}
              tickLine={false}
              axisLine={false}
              width={28}
            />
            <ChartTooltip
              cursor={false}
              content={<ChartTooltipContent hideLabel />}
            />
            <Bar dataKey="count" fill="var(--color-count)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}

function DonutCard({
  title,
  rows,
}: {
  title: string
  rows: Array<[string, number]>
}) {
  const data = rows.map(([name, count], i) => ({
    name,
    count,
    fill: CHART_COLORS[i % CHART_COLORS.length],
  }))
  const config = Object.fromEntries(
    rows.map(([name], i) => [
      name,
      { label: name, color: CHART_COLORS[i % CHART_COLORS.length] },
    ]),
  ) as ChartConfig
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <p className="text-muted-foreground text-sm">No data yet.</p>
        ) : (
          <ChartContainer config={config} className="mx-auto aspect-square h-56">
            <PieChart>
              <ChartTooltip
                cursor={false}
                content={<ChartTooltipContent hideLabel />}
              />
              <Pie
                data={data}
                dataKey="count"
                nameKey="name"
                innerRadius={50}
                strokeWidth={2}
              />
              <ChartLegend content={<ChartLegendContent nameKey="name" />} />
            </PieChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  )
}

function RegionChart({ rows }: { rows: Array<[string, number]> }) {
  const data = rows.map(([region, count]) => ({ region, count }))
  const config = {
    count: { label: "Discs", color: "var(--chart-2)" },
  } satisfies ChartConfig
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Disc region</CardTitle>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <p className="text-muted-foreground text-sm">No data yet.</p>
        ) : (
          <ChartContainer config={config} className="h-56 w-full">
            <BarChart accessibilityLayer data={data}>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="region"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
              />
              <YAxis
                allowDecimals={false}
                tickLine={false}
                axisLine={false}
                width={28}
              />
              <ChartTooltip
                cursor={false}
                content={<ChartTooltipContent hideLabel />}
              />
              <Bar
                dataKey="count"
                fill="var(--color-count)"
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  )
}

function StatsPage() {
  const { data: films } = useSuspenseQuery(filmsQuery)

  const stats = useMemo(() => computeStats(films), [films])

  if (films.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>No stats yet</EmptyTitle>
          <EmptyDescription>
            <Link to="/add" className="text-lb-blue hover:underline">
              Add some films
            </Link>{" "}
            and the numbers will appear here.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Stats</h1>
        <p className="text-sm text-muted-foreground">The state of the shelf.</p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard
          label="Total discs"
          value={stats.totalDiscs}
          accent="text-lb-green"
        />
        <StatCard label="Top-level titles" value={stats.totalTitles} />
        <StatCard label="Unique directors" value={stats.uniqueDirectors} />
        <StatCard
          label="Watched"
          value={`${stats.watchedPct}%`}
          detail={`${stats.watched} of ${stats.totalTitles} titles`}
          accent="text-lb-green"
        />
        <StatCard
          label="Oldest title"
          value={stats.oldest?.year ?? "—"}
          detail={stats.oldest?.title}
        />
        <StatCard
          label="Newest title"
          value={stats.newest?.year ?? "—"}
          detail={stats.newest?.title}
        />
        <StatCard
          label="Longest runtime"
          value={
            stats.longest?.runtimeMinutes
              ? formatRuntime(stats.longest.runtimeMinutes)
              : "—"
          }
          detail={stats.longest?.title}
          accent="text-lb-orange"
        />
        <StatCard
          label="Shortest runtime"
          value={
            stats.shortest?.runtimeMinutes
              ? formatRuntime(stats.shortest.runtimeMinutes)
              : "—"
          }
          detail={stats.shortest?.title}
        />
        <StatCard
          label="Total paid"
          value={stats.totalPaid > 0 ? formatPrice(stats.totalPaid) : "—"}
          detail={
            stats.pricedCount > 0
              ? `${stats.pricedCount} of ${stats.totalTitles} priced · avg ${formatPrice(stats.totalPaid / stats.pricedCount)}`
              : "Add prices from each film's edit form"
          }
          accent="text-lb-green"
        />
        <StatCard
          label="Shelf runtime"
          value={stats.totalRuntimeMinutes > 0 ? formatDays(stats.totalRuntimeMinutes) : "—"}
          detail="every disc back to back"
        />
        <StatCard
          label="Combined box office"
          value={
            stats.totalBoxOffice > 0 ? formatUsdCompact(stats.totalBoxOffice) : "—"
          }
          detail={
            stats.boxOfficeCount > 0
              ? `worldwide gross across ${stats.boxOfficeCount} films`
              : undefined
          }
          accent="text-lb-orange"
        />
        <StatCard
          label="Rotten Tomatoes avg"
          value={stats.avgCritics != null ? `${stats.avgCritics}%` : "—"}
          detail={
            stats.avgAudience != null
              ? `critics · audience ${stats.avgAudience}%`
              : "Sync scores from Settings"
          }
        />
      </div>

      <DecadeChart rows={stats.byDecade} />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <DonutCard title="Media type" rows={stats.byFormat} />
        <DonutCard title="Resolution" rows={stats.byResolution} />
        <RegionChart rows={stats.byRegion} />
        <AgeRatingChart rows={stats.byCertification} />
        <RankedCard title="Biggest box office" rows={stats.topBoxOffice} />
        <RankedCard title="Biggest budgets" rows={stats.topBudget} />
        <RankedCard
          title="Return on budget"
          rows={stats.returnOnBudget}
        />
        <BreakdownCard
          title="Top directors"
          rows={stats.topDirectors}
          personLinks
        />
        <BreakdownCard
          title="Top actors"
          rows={stats.topActors}
          max={10}
          personLinks
        />
        <BreakdownCard title="Top publishers" rows={stats.byPublisher} max={10} />
        <BreakdownCard
          title="Publisher by package type"
          rows={stats.publisherPackage}
          max={10}
        />
        <BreakdownCard
          title="Production companies"
          rows={stats.byProductionCompany}
          max={10}
        />
        <BreakdownCard title="Genres" rows={stats.byGenre} max={10} />
        <BreakdownCard title="Countries" rows={stats.byCountry} max={10} />
        <BreakdownCard title="Languages" rows={stats.byLanguage} max={8} />
        <BreakdownCard
          title="Franchises on the shelf"
          rows={stats.franchises}
          max={8}
        />
      </div>
    </div>
  )
}

/** "8,340 minutes" reads as nothing — days + hours lands. */
function formatDays(minutes: number): string {
  const days = Math.floor(minutes / 60 / 24)
  const hours = Math.round((minutes - days * 24 * 60) / 60)
  return days > 0 ? `${days}d ${hours}h` : `${hours}h`
}

// TMDB codes that Intl.DisplayNames doesn't know.
const TMDB_LANGUAGES: Record<string, string> = { cn: "Cantonese", xx: "None" }

function languageName(code: string | null | undefined): string | null {
  if (!code) return null
  if (TMDB_LANGUAGES[code]) return TMDB_LANGUAGES[code]
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code
  } catch {
    return code
  }
}

const mean = (values: number[]) =>
  values.length > 0
    ? Math.round(values.reduce((sum, n) => sum + n, 0) / values.length)
    : null

function computeStats(films: Film[]) {
  const totalDiscs = films.reduce((sum, f) => sum + f.discCount, 0)
  const watched = films.filter(isWatched).length

  const priced = films.filter((f) => f.pricePaid != null)
  const totalPaid = priced.reduce((sum, f) => sum + Number(f.pricePaid), 0)

  const withRevenue = films.filter((f) => f.tmdbDetails?.revenue)
  const totalBoxOffice = withRevenue.reduce(
    (sum, f) => sum + (f.tmdbDetails?.revenue ?? 0),
    0,
  )

  const topBoxOffice = [...withRevenue]
    .sort((a, b) => b.tmdbDetails!.revenue! - a.tmdbDetails!.revenue!)
    .slice(0, 10)
    .map((f) => ({
      id: f.id,
      name: f.title,
      value: f.tmdbDetails!.revenue!,
      display: formatUsdCompact(f.tmdbDetails!.revenue!),
    }))

  const topBudget = films
    .filter((f) => f.tmdbDetails?.budget)
    .sort((a, b) => b.tmdbDetails!.budget! - a.tmdbDetails!.budget!)
    .slice(0, 10)
    .map((f) => ({
      id: f.id,
      name: f.title,
      value: f.tmdbDetails!.budget!,
      display: formatUsdCompact(f.tmdbDetails!.budget!),
    }))

  // Return on budget — how many times each film made its money back.
  const returnOnBudget = films
    .filter((f) => f.tmdbDetails?.budget && f.tmdbDetails.revenue)
    .map((f) => {
      const { budget, revenue } = f.tmdbDetails!
      const multiple = revenue! / budget!
      return {
        id: f.id,
        name: f.title,
        value: multiple,
        display: `${multiple >= 10 ? Math.round(multiple) : multiple.toFixed(1)}×`,
        detail: `${formatUsdCompact(revenue!)} on ${formatUsdCompact(budget!)}`,
      }
    })
    .sort((a, b) => b.value - a.value)
    .slice(0, 10)

  const byCertification = tally(
    films,
    (f) => f.tmdbDetails?.certification ?? null,
  )
  byCertification.sort((a, b) => {
    const ai = CERT_ORDER.indexOf(a[0])
    const bi = CERT_ORDER.indexOf(b[0])
    return (
      (ai === -1 ? CERT_ORDER.length : ai) -
        (bi === -1 ? CERT_ORDER.length : bi) || a[0].localeCompare(b[0])
    )
  })

  const withYear = films.filter((f) => f.year != null)
  const oldest = withYear.reduce<Film | null>(
    (best, f) => (best == null || f.year! < best.year! ? f : best),
    null
  )
  const newest = withYear.reduce<Film | null>(
    (best, f) => (best == null || f.year! > best.year! ? f : best),
    null
  )

  // TV sets store total series runtime, which would dwarf any feature —
  // longest/shortest only compare films.
  const withRuntime = films.filter(
    (f) => f.runtimeMinutes != null && f.tmdbMediaType !== "tv",
  )
  const longest = withRuntime.reduce<Film | null>(
    (best, f) =>
      best == null || f.runtimeMinutes! > best.runtimeMinutes! ? f : best,
    null
  )
  const shortest = withRuntime.reduce<Film | null>(
    (best, f) =>
      best == null || f.runtimeMinutes! < best.runtimeMinutes! ? f : best,
    null
  )

  const byDecade = tally(withYear, (f) => `${Math.floor(f.year! / 10) * 10}s`)
  byDecade.sort((a, b) => a[0].localeCompare(b[0]))

  return {
    totalTitles: films.length,
    totalDiscs,
    uniqueDirectors: new Set(
      films.flatMap(directorsOf).map((name) => name.toLowerCase())
    ).size,
    watched,
    watchedPct: Math.round((watched / films.length) * 100),
    oldest,
    newest,
    longest,
    shortest,
    byDecade,
    topDirectors: tally(films.flatMap(directorsOf), (name) => name),
    topActors: tally(
      films.flatMap((f) => f.tmdbCast ?? []),
      (member) => member.name,
    ),
    byFormat: tally(films, (f) => f.format),
    byResolution: tally(films, resolutionOf),
    byRegion: tally(films, (f) => f.region && `Region ${f.region}`),
    publisherPackage: tally(films, (f) =>
      f.label ? `${f.label} — ${f.packageType ?? "Standard"}` : null
    ),
    byPublisher: tally(films, (f) => f.label),
    byProductionCompany: tally(
      films.flatMap((f) => f.tmdbDetails?.productionCompanies ?? []),
      (name) => name,
    ),
    byGenre: tally(
      films.flatMap((f) => f.tmdbDetails?.genres ?? []),
      (name) => name,
    ),
    byCountry: tally(
      films.flatMap((f) => f.tmdbDetails?.productionCountries ?? []),
      (name) => name,
    ),
    byLanguage: tally(films, (f) =>
      languageName(f.tmdbDetails?.originalLanguage),
    ),
    // A "franchise" needs at least two owned entries — one is just a film.
    franchises: tally(films, (f) => f.tmdbDetails?.collection ?? null).filter(
      ([, count]) => count >= 2,
    ),
    topBoxOffice,
    topBudget,
    returnOnBudget,
    byCertification,
    totalPaid,
    pricedCount: priced.length,
    totalRuntimeMinutes: films.reduce(
      (sum, f) => sum + (f.runtimeMinutes ?? 0),
      0,
    ),
    totalBoxOffice,
    boxOfficeCount: withRevenue.length,
    avgCritics: mean(
      films.map((f) => f.rtCriticsScore).filter((n): n is number => n != null),
    ),
    avgAudience: mean(
      films
        .map((f) => f.rtAudienceScore)
        .filter((n): n is number => n != null),
    ),
  }
}
