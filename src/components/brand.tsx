import { cn } from "@/lib/utils"

/**
 * The Spine mark — three DVD cases on a shelf in the Letterboxd trio,
 * the last one leaning. Same artwork as the favicon, sans tile.
 */
export function SpineMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="96 120 330 296"
      aria-hidden="true"
      className={cn("h-6 w-auto", className)}
    >
      <rect x="122" y="136" width="68" height="256" rx="15" fill="#ff8000" />
      <rect x="206" y="136" width="68" height="256" rx="15" fill="#00e054" />
      <g transform="rotate(-15 318 392)">
        <rect
          x="318"
          y="136"
          width="68"
          height="256"
          rx="15"
          fill="#40bcf4"
          style={{ mixBlendMode: "screen" }}
        />
      </g>
      <rect
        x="106"
        y="398"
        width="300"
        height="12"
        rx="6"
        fill="currentColor"
        opacity="0.25"
      />
    </svg>
  )
}

export function Brand({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <SpineMark />
      <span className="text-lg font-extrabold tracking-[0.18em] text-foreground">
        SPINE
      </span>
    </span>
  )
}
