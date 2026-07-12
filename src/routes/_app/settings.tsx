import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { History, Loader2, RefreshCw } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { settingsQuery } from "@/lib/queries"
import { syncCriterionSpinesFn } from "@/server/criterion"
import {
  syncLetterboxdFn,
  syncLetterboxdHistoryFn,
} from "@/server/letterboxd"
import { saveSettingsFn } from "@/server/settings"
import { syncTmdbCastFn } from "@/server/tmdb"

export const Route = createFileRoute("/_app/settings")({
  loader: ({ context }) => context.queryClient.ensureQueryData(settingsQuery),
  component: SettingsPage,
})

function SettingsPage() {
  const { data: settings } = useSuspenseQuery(settingsQuery)
  const queryClient = useQueryClient()
  const [username, setUsername] = useState(settings?.letterboxdUsername ?? "")

  const save = useMutation({
    mutationFn: saveSettingsFn,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["settings"] })
      toast.success("Settings saved")
    },
    onError: () => toast.error("Could not save settings"),
  })

  const sync = useMutation({
    mutationFn: () => syncLetterboxdFn(),
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["settings"] }),
        queryClient.invalidateQueries({ queryKey: ["films"] }),
      ])
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success(
        result.matched > 0
          ? `Synced — ${result.matched} title${result.matched === 1 ? "" : "s"} newly marked watched`
          : `Synced — no new first-time watches matched (${result.scanned} diary entries checked)`
      )
    },
    onError: () => toast.error("Sync failed"),
  })

  const historySync = useMutation({
    mutationFn: () => syncLetterboxdHistoryFn(),
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["settings"] }),
        queryClient.invalidateQueries({ queryKey: ["films"] }),
      ])
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success(
        result.matched > 0
          ? `Full history synced — ${result.matched} title${result.matched === 1 ? "" : "s"} newly marked watched (${result.filmsSeen} films across ${result.pages} page${result.pages === 1 ? "" : "s"})`
          : `Full history synced — no new matches (${result.filmsSeen} films checked)`,
      )
    },
    onError: () => toast.error("History sync failed"),
  })

  const tmdbSync = useMutation({
    mutationFn: () => syncTmdbCastFn(),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["films"] })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success(
        result.scanned === 0
          ? "All films already have cast data"
          : `Cast fetched for ${result.updated} of ${result.scanned} film${result.scanned === 1 ? "" : "s"}${result.unmatched > 0 ? ` (${result.unmatched} had no TMDB match)` : ""}`,
      )
    },
    onError: () => toast.error("TMDB sync failed"),
  })

  const spineSync = useMutation({
    mutationFn: () => syncCriterionSpinesFn(),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["films"] })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success(
        result.scanned === 0
          ? `All Criterion titles already have spine numbers (list has ${result.listSize} entries)`
          : `Spine numbers filled for ${result.updated} of ${result.scanned} Criterion title${result.scanned === 1 ? "" : "s"}`,
      )
    },
    onError: () => toast.error("Spine sync failed"),
  })

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Letterboxd sync</CardTitle>
          <CardDescription>
            Watched state is pulled from your public Letterboxd RSS feed.
            First-time watches only — rewatches are ignored. You can pin any
            title manually from its detail page.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault()
              save.mutate({
                data: { letterboxdUsername: username.trim() || null },
              })
            }}
          >
            <Field>
              <FieldLabel htmlFor="lb-user">Letterboxd username</FieldLabel>
              <div className="flex gap-2">
                <Input
                  id="lb-user"
                  placeholder="e.g. davidehrlich"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
                <Button type="submit" disabled={save.isPending}>
                  {save.isPending && (
                    <Loader2 className="size-4 animate-spin" />
                  )}
                  Save
                </Button>
              </div>
              <FieldDescription>
                letterboxd.com/<b>{username || "username"}</b>/rss
              </FieldDescription>
            </Field>
          </form>

          <div className="flex items-center justify-between gap-4 border-t pt-4">
            <div className="text-sm text-muted-foreground">
              {settings?.lastLetterboxdSyncAt
                ? `Last synced ${new Date(settings.lastLetterboxdSyncAt).toLocaleString()}`
                : "Never synced"}
            </div>
            <Button
              variant="secondary"
              className="gap-2"
              disabled={sync.isPending || !settings?.letterboxdUsername}
              onClick={() => sync.mutate()}
            >
              {sync.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}
              Sync now
            </Button>
          </div>

          <div className="flex items-center justify-between gap-4 border-t pt-4">
            <p className="text-sm text-muted-foreground">
              The feed only covers recent entries. Sync your <b>full diary</b>{" "}
              from letterboxd.com/{settings?.letterboxdUsername || "username"}
              /diary — first watch dates, your ratings, and review links for
              everything you've ever logged.
            </p>
            <Button
              variant="secondary"
              className="shrink-0 gap-2"
              disabled={
                historySync.isPending || !settings?.letterboxdUsername
              }
              onClick={() => historySync.mutate()}
            >
              {historySync.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <History className="size-4" />
              )}
              Sync full history
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>TMDB cast data</CardTitle>
          <CardDescription>
            Cast is fetched automatically from TMDB when you add a film.
            Run a backfill to fetch it for films added before TMDB was
            configured — it powers the "Top actors" stat.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between gap-4">
            <p className="text-muted-foreground text-sm">
              Requires <code>TMDB_API_KEY</code> in <code>.env</code>.
            </p>
            <Button
              variant="secondary"
              className="gap-2"
              disabled={tmdbSync.isPending}
              onClick={() => tmdbSync.mutate()}
            >
              {tmdbSync.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}
              Fetch missing cast
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Criterion spine numbers</CardTitle>
          <CardDescription>
            Spine numbers come from criterion.com's release list and are
            filled automatically when you add a film with a Criterion label.
            Run a backfill for titles added before, or after new releases.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between gap-4">
            <p className="text-muted-foreground text-sm">
              Applies to films whose publisher contains "Criterion".
            </p>
            <Button
              variant="secondary"
              className="gap-2"
              disabled={spineSync.isPending}
              onClick={() => spineSync.mutate()}
            >
              {spineSync.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}
              Fetch missing spines
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
