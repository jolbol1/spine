import { ChevronDown, Plus, X } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type {
  Film,
  Shelf,
  ShelfRule,
  ShelfRuleField,
  ShelfSortKey,
  ShelfSortLevel,
} from "@/db/schema"
import {
  SHELF_RULE_FIELDS,
  SHELF_SORT_KEYS,
  assignFilms,
  matchesShelfRules,
  shelfFieldOptions,
} from "@/lib/shelves"

const NONE = "none"

const GROUP_BY_OPTIONS = [
  [NONE, "No grouping"],
  ["label", "Publisher"],
  ["format", "Format"],
  ["decade", "Decade"],
] as const

/** Multi-select for one rule's values — checkbox list with counts. */
function RuleValuePicker({
  options,
  values,
  onChange,
}: {
  options: Array<[string, number]>
  values: string[]
  onChange: (values: string[]) => void
}) {
  const toggle = (value: string) =>
    onChange(
      values.includes(value)
        ? values.filter((v) => v !== value)
        : [...values, value]
    )
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            className="min-w-0 flex-1 justify-between gap-2 font-normal"
          />
        }
      >
        <span className="truncate">
          {values.length === 0
            ? "Any value"
            : values.length <= 2
              ? values.join(", ")
              : `${values.length} selected`}
        </span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
        {options.length === 0 && (
          <p className="px-3 py-2 text-xs text-muted-foreground">
            Nothing in your collection has this field.
          </p>
        )}
        {options.map(([value, count]) => (
          <DropdownMenuCheckboxItem
            key={value}
            checked={values.includes(value)}
            closeOnClick={false}
            onCheckedChange={() => toggle(value)}
          >
            {value}{" "}
            <span className="text-xs text-muted-foreground">({count})</span>
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const FIELD_ITEMS = Object.fromEntries(
  SHELF_RULE_FIELDS.map(({ field, label }) => [field, label])
)
const SORT_ITEMS = Object.fromEntries(
  SHELF_SORT_KEYS.map(({ key, label }) => [key, label])
)

export function ShelfBuilderDialog({
  open,
  onOpenChange,
  films,
  shelves,
  editing,
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  films: Film[]
  /** The full current layout — used for precedence conflict hints. */
  shelves: Shelf[]
  /** Shelf being edited, or null to create a new one (appended last). */
  editing: Shelf | null
  onSave: (shelf: Shelf) => void
}) {
  const [name, setName] = useState("")
  const [rules, setRules] = useState<ShelfRule[]>([])
  const [sort, setSort] = useState<ShelfSortLevel[]>([])
  const [groupBy, setGroupBy] = useState<string>(NONE)
  const [capacity, setCapacity] = useState("")

  // Re-seed the form whenever the dialog opens on a different shelf.
  useEffect(() => {
    if (!open) return
    setName(editing?.name ?? "")
    setRules(editing?.rules ?? [{ field: "format", values: [] }])
    setSort(editing?.sort ?? [])
    setGroupBy(editing?.groupBy ?? NONE)
    setCapacity(editing?.capacity != null ? String(editing.capacity) : "")
  }, [open, editing])

  const optionsByField = useMemo(() => {
    const result = {} as Record<ShelfRuleField, Array<[string, number]>>
    for (const { field } of SHELF_RULE_FIELDS) {
      result[field] = shelfFieldOptions(films, field)
    }
    return result
  }, [films])

  /** The draft as a Shelf, in its final position in the layout. */
  const draft: Shelf = useMemo(
    () => ({
      id: editing?.id ?? "draft",
      name: name.trim() || "New shelf",
      rules: rules.filter((r) => r.values.length > 0),
      sort: sort.length > 0 ? sort : undefined,
      groupBy: groupBy === NONE ? undefined : (groupBy as Shelf["groupBy"]),
      capacity: /^\d+$/.test(capacity) ? Number(capacity) : undefined,
      pinned: editing?.pinned,
      excluded: editing?.excluded,
      manualOrder: editing?.manualOrder,
      arrangedAt: editing?.arrangedAt,
    }),
    [editing, name, rules, sort, groupBy, capacity]
  )

  // Live preview: what the draft's rules match, and how much of that a
  // higher shelf claims first — precedence made tangible before saving.
  const preview = useMemo(() => {
    if (!open) return null
    const layout = editing
      ? shelves.map((s) => (s.id === editing.id ? draft : s))
      : [...shelves, draft]
    const draftIndex = layout.findIndex((s) => s.id === draft.id)
    const matching = films.filter((f) => matchesShelfRules(f, draft))
    const { byShelf } = assignFilms(films, layout)
    const claimed = new Map<string, number>()
    for (const [index, s] of layout.entries()) {
      if (index >= draftIndex) continue
      const count = byShelf
        .get(s.id)!
        .filter((f) => matchesShelfRules(f, draft)).length
      if (count > 0) claimed.set(s.name, count)
    }
    return {
      matching: matching.length,
      assigned: byShelf.get(draft.id)!.length,
      claimed: [...claimed.entries()],
    }
  }, [open, films, shelves, editing, draft])

  const setRule = (index: number, rule: ShelfRule) =>
    setRules(rules.map((r, i) => (i === index ? rule : r)))

  const save = () => {
    if (!name.trim()) return
    onSave({
      ...draft,
      id: editing?.id ?? crypto.randomUUID(),
      name: name.trim(),
    })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit shelf" : "New shelf"}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault()
            save()
          }}
        >
          <Field>
            <FieldLabel htmlFor="shelf-name">Name</FieldLabel>
            <Input
              id="shelf-name"
              autoFocus
              placeholder="e.g. Boutique editions, 4K wall, TV box sets…"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>

          <div className="space-y-2">
            <p className="text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
              Rules — films must match all of them
            </p>
            {rules.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No rules: this shelf catches every film not already claimed by a
                shelf above it.
              </p>
            )}
            {rules.map((rule, index) => (
              <div key={index} className="flex items-center gap-2">
                <Select
                  value={rule.field}
                  items={FIELD_ITEMS}
                  onValueChange={(field) =>
                    setRule(index, {
                      field: field as ShelfRuleField,
                      values: [],
                    })
                  }
                >
                  <SelectTrigger className="w-32 shrink-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SHELF_RULE_FIELDS.map(({ field, label }) => (
                      <SelectItem key={field} value={field}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <RuleValuePicker
                  options={optionsByField[rule.field]}
                  values={rule.values}
                  onChange={(values) => setRule(index, { ...rule, values })}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Remove rule"
                  onClick={() => setRules(rules.filter((_, i) => i !== index))}
                >
                  <X className="size-4" />
                </Button>
              </div>
            ))}
            {rules.length < 10 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() =>
                  setRules([...rules, { field: "format", values: [] }])
                }
              >
                <Plus className="size-3.5" /> Add rule
              </Button>
            )}
          </div>

          <div className="space-y-2">
            <p className="text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
              Order on the shelf
            </p>
            {sort.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Default: alphabetical by title.
              </p>
            )}
            {sort.map((level, index) => (
              <div key={index} className="flex items-center gap-2">
                <Select
                  value={level.key}
                  items={SORT_ITEMS}
                  onValueChange={(key) =>
                    setSort(
                      sort.map((l, i) =>
                        i === index
                          ? { key: key as ShelfSortKey, dir: undefined }
                          : l
                      )
                    )
                  }
                >
                  <SelectTrigger className="flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SHELF_SORT_KEYS.map(({ key, label }) => (
                      <SelectItem key={key} value={key}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label="Flip direction"
                  onClick={() =>
                    setSort(
                      sort.map((l, i) =>
                        i === index
                          ? { ...l, dir: l.dir === "desc" ? "asc" : "desc" }
                          : l
                      )
                    )
                  }
                >
                  {level.dir === "desc" ? "▼" : "▲"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Remove sort level"
                  onClick={() => setSort(sort.filter((_, i) => i !== index))}
                >
                  <X className="size-4" />
                </Button>
              </div>
            ))}
            {sort.length < 3 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => setSort([...sort, { key: "title" }])}
              >
                <Plus className="size-3.5" />{" "}
                {sort.length === 0 ? "Custom sort" : "Add tie-break"}
              </Button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel>Group within shelf</FieldLabel>
              <Select
                value={groupBy}
                items={Object.fromEntries(GROUP_BY_OPTIONS)}
                onValueChange={(v) => setGroupBy(v as string)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GROUP_BY_OPTIONS.map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="shelf-capacity">
                Capacity (optional)
              </FieldLabel>
              <Input
                id="shelf-capacity"
                type="number"
                min={1}
                placeholder="Physical slots"
                value={capacity}
                onChange={(e) => setCapacity(e.target.value)}
              />
            </Field>
          </div>

          {preview && (
            <div className="space-y-1 rounded-md border bg-secondary/30 px-3 py-2 text-xs">
              <p>
                <span className="font-semibold">{preview.matching}</span> title
                {preview.matching === 1 ? "" : "s"} match these rules —{" "}
                <span className="font-semibold">{preview.assigned}</span> would
                live on this shelf.
              </p>
              {preview.claimed.map(([shelfName, count]) => (
                <p key={shelfName} className="text-muted-foreground">
                  “{shelfName}” sits higher and claims {count} of them first.
                </p>
              ))}
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim()}>
              {editing ? "Save shelf" : "Add shelf"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
