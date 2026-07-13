import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import {
  ExternalLink,
  Library,
  Link2,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import type { WishlistItem } from "@/db/schema"
import { FILM_FORMATS, filmFormatSchema } from "@/lib/film-formats"
import type { FilmFormat } from "@/lib/film-formats"
import { wishlistQuery } from "@/lib/queries"
import {
  createWishlistItemFn,
  deleteWishlistItemFn,
  moveToCollectionFn,
  scrapeWishlistUrlFn,
} from "@/server/wishlist"

export const Route = createFileRoute("/_app/wishlist")({
  loader: ({ context }) => context.queryClient.ensureQueryData(wishlistQuery),
  component: WishlistPage,
})

interface DraftItem {
  title: string
  year: string
  format: FilmFormat
  url: string
  retailer: string
  price: string
  coverUrl: string
  notes: string
}

const emptyDraft: DraftItem = {
  title: "",
  year: "",
  format: "Blu-ray",
  url: "",
  retailer: "",
  price: "",
  coverUrl: "",
  notes: "",
}

function WishlistPage() {
  const { data: items } = useSuspenseQuery(wishlistQuery)
  const queryClient = useQueryClient()

  const [url, setUrl] = useState("")
  const [draft, setDraft] = useState<DraftItem | null>(null)

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["wishlist"] })

  const scrape = useMutation({
    mutationFn: scrapeWishlistUrlFn,
    onSuccess: (result) => {
      if (!result.success) {
        toast.error(result.error)
        // Still open the dialog so the item can be filled in manually.
        setDraft({ ...emptyDraft, url, retailer: result.retailer ?? "" })
        return
      }
      setDraft({
        ...emptyDraft,
        title: result.data.title,
        url: result.data.url,
        retailer: result.data.retailer,
        price: result.data.price ?? "",
        coverUrl: result.data.imageUrl ?? "",
      })
    },
    onError: () => toast.error("Scrape failed — add the item manually"),
  })

  const create = useMutation({
    mutationFn: createWishlistItemFn,
    onSuccess: async () => {
      await invalidate()
      setDraft(null)
      setUrl("")
      toast.success("Added to wishlist")
    },
    onError: () => toast.error("Could not add — a title is required"),
  })

  const remove = useMutation({
    mutationFn: deleteWishlistItemFn,
    onSuccess: invalidate,
  })

  const move = useMutation({
    mutationFn: moveToCollectionFn,
    onSuccess: async (film) => {
      await Promise.all([
        invalidate(),
        queryClient.invalidateQueries({ queryKey: ["films"] }),
      ])
      if (film) toast.success(`“${film.title}” moved to your collection`)
    },
    onError: () => toast.error("Could not move to collection"),
  })

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Wishlist</h1>
          <p className="text-sm text-muted-foreground">
            Paste a product link from a supported retailer — HMV, Zavvi, Amazon,
            Arrow, Criterion, Indicator, Eureka, BFI and more.
          </p>
        </div>
        <Button
          variant="outline"
          className="gap-2"
          onClick={() => setDraft({ ...emptyDraft })}
        >
          <Plus className="size-4" /> Add manually
        </Button>
      </div>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (!url.trim()) return
          scrape.mutate({ data: { url: url.trim() } })
        }}
      >
        <div className="relative flex-1">
          <Link2 className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.criterion.com/films/…"
            className="pl-8"
          />
        </div>
        <Button type="submit" disabled={scrape.isPending || !url.trim()}>
          {scrape.isPending && <Loader2 className="size-4 animate-spin" />}
          {scrape.isPending ? "Scraping…" : "Fetch details"}
        </Button>
      </form>

      {items.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Nothing on the wishlist</EmptyTitle>
            <EmptyDescription>
              Paste a retailer link above to start tracking releases you want.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <WishlistCard
              key={item.id}
              item={item}
              onMove={() => move.mutate({ data: { id: item.id } })}
              onDelete={() => remove.mutate({ data: { id: item.id } })}
              busy={move.isPending || remove.isPending}
            />
          ))}
        </div>
      )}

      <Dialog
        open={draft !== null}
        onOpenChange={(open) => !open && setDraft(null)}
      >
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add to wishlist</DialogTitle>
            <DialogDescription>
              Check the scraped details before saving.
            </DialogDescription>
          </DialogHeader>
          {draft && (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault()
                create.mutate({
                  data: {
                    title: draft.title,
                    year: draft.year ? Number(draft.year) : null,
                    format: draft.format,
                    url: draft.url || null,
                    retailer: draft.retailer || null,
                    price: draft.price || null,
                    coverUrl: draft.coverUrl || null,
                    notes: draft.notes || null,
                  },
                })
              }}
            >
              <div className="flex gap-4">
                {draft.coverUrl && (
                  <img
                    src={draft.coverUrl}
                    alt=""
                    className="h-32 w-auto rounded-md bg-secondary object-cover"
                  />
                )}
                <div className="flex-1 space-y-3">
                  <Field>
                    <FieldLabel htmlFor="w-title">Title *</FieldLabel>
                    <Input
                      id="w-title"
                      required
                      value={draft.title}
                      onChange={(e) =>
                        setDraft({ ...draft, title: e.target.value })
                      }
                    />
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field>
                      <FieldLabel htmlFor="w-year">Year</FieldLabel>
                      <Input
                        id="w-year"
                        type="number"
                        value={draft.year}
                        onChange={(e) =>
                          setDraft({ ...draft, year: e.target.value })
                        }
                      />
                    </Field>
                    <Field>
                      <FieldLabel>Format</FieldLabel>
                      <Select
                        value={draft.format}
                        onValueChange={(format) => {
                          setDraft({
                            ...draft,
                            format: filmFormatSchema.parse(format),
                          })
                        }}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {FILM_FORMATS.map((format) => (
                            <SelectItem key={format} value={format}>
                              {format}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field>
                  <FieldLabel htmlFor="w-price">Price</FieldLabel>
                  <Input
                    id="w-price"
                    placeholder="£24.99"
                    value={draft.price}
                    onChange={(e) =>
                      setDraft({ ...draft, price: e.target.value })
                    }
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="w-retailer">Retailer</FieldLabel>
                  <Input
                    id="w-retailer"
                    value={draft.retailer}
                    onChange={(e) =>
                      setDraft({ ...draft, retailer: e.target.value })
                    }
                  />
                </Field>
              </div>
              <Field>
                <FieldLabel htmlFor="w-url">Link</FieldLabel>
                <Input
                  id="w-url"
                  value={draft.url}
                  onChange={(e) => setDraft({ ...draft, url: e.target.value })}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="w-notes">Notes</FieldLabel>
                <Textarea
                  id="w-notes"
                  rows={2}
                  value={draft.notes}
                  onChange={(e) =>
                    setDraft({ ...draft, notes: e.target.value })
                  }
                />
              </Field>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDraft(null)}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={create.isPending}>
                  {create.isPending && (
                    <Loader2 className="size-4 animate-spin" />
                  )}
                  Save to wishlist
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function WishlistCard({
  item,
  onMove,
  onDelete,
  busy,
}: {
  item: WishlistItem
  onMove: () => void
  onDelete: () => void
  busy: boolean
}) {
  return (
    <Card className="overflow-hidden">
      <CardContent className="flex gap-4 p-4">
        <div className="h-28 w-20 shrink-0 overflow-hidden rounded-md bg-secondary">
          {item.coverUrl && (
            <img
              src={item.coverUrl}
              alt=""
              loading="lazy"
              className="size-full object-cover"
            />
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <p className="truncate font-medium" title={item.title}>
            {item.title}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {item.retailer && (
              <Badge variant="secondary">{item.retailer}</Badge>
            )}
            {item.format && <Badge variant="outline">{item.format}</Badge>}
            {item.price && (
              <span className="text-sm font-semibold text-lb-orange">
                {item.price}
              </span>
            )}
          </div>
          {item.notes && (
            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
              {item.notes}
            </p>
          )}
          <div className="mt-auto flex items-center gap-1 pt-2">
            <Button
              size="sm"
              variant="secondary"
              className="gap-1.5"
              disabled={busy}
              onClick={onMove}
              title="Bought it — move to collection"
            >
              <Library className="size-3.5" /> Own it
            </Button>
            {item.url && (
              <Button
                size="icon-sm"
                variant="ghost"
                render={
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                    aria-label="Open retailer page"
                  />
                }
              >
                <ExternalLink className="size-3.5" />
              </Button>
            )}
            <Button
              size="icon-sm"
              variant="ghost"
              className="text-destructive"
              aria-label="Remove from wishlist"
              disabled={busy}
              onClick={onDelete}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
