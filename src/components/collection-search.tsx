import { Search } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { Input } from "@/components/ui/input"

export function CollectionSearch({
  query,
  onQueryChange,
}: {
  query: string
  onQueryChange: (query: string) => void
}) {
  const [value, setValue] = useState(query)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setValue(query)
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = null
  }, [query])

  useEffect(
    () => () => {
      if (debounce.current) clearTimeout(debounce.current)
    },
    [],
  )

  const handleChange = (next: string) => {
    setValue(next)
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(() => onQueryChange(next.trim()), 300)
  }

  return (
    <div className="relative">
      <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={value}
        onChange={(event) => handleChange(event.target.value)}
        placeholder="Search title, director, spine…"
        className="w-64 pl-8"
      />
    </div>
  )
}
