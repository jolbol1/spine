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
import { formatRuntime, isWatched, resolutionOf } from "@/lib/film-helpers"
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
}: {
  title: string
  rows: Array<[string, number]>
  max?: number
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
              <span className="truncate">{name}</span>
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
      </div>

      <DecadeChart rows={stats.byDecade} />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <DonutCard title="Media type" rows={stats.byFormat} />
        <DonutCard title="Resolution" rows={stats.byResolution} />
        <RegionChart rows={stats.byRegion} />
        <BreakdownCard title="Top directors" rows={stats.topDirectors} />
        <BreakdownCard title="Top actors" rows={stats.topActors} max={10} />
        <BreakdownCard
          title="Publisher by package type"
          rows={stats.publisherPackage}
          max={10}
        />
      </div>
    </div>
  )
}

function computeStats(films: Film[]) {
  const totalDiscs = films.reduce((sum, f) => sum + f.discCount, 0)
  const watched = films.filter(isWatched).length

  const withYear = films.filter((f) => f.year != null)
  const oldest = withYear.reduce<Film | null>(
    (best, f) => (best == null || f.year! < best.year! ? f : best),
    null
  )
  const newest = withYear.reduce<Film | null>(
    (best, f) => (best == null || f.year! > best.year! ? f : best),
    null
  )

  const withRuntime = films.filter((f) => f.runtimeMinutes != null)
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
      films.map((f) => f.director?.trim().toLowerCase()).filter(Boolean)
    ).size,
    watched,
    watchedPct: Math.round((watched / films.length) * 100),
    oldest,
    newest,
    longest,
    shortest,
    byDecade,
    topDirectors: tally(films, (f) => f.director?.trim() || null),
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
  }
}
