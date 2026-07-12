import { cn } from "@/lib/utils"

/** Letterboxd-style tri-color dot cluster — the app's signature mark. */
export function TriDots({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center -space-x-1.5", className)}>
      <span className="size-3.5 rounded-full bg-lb-orange" />
      <span className="size-3.5 rounded-full bg-lb-green mix-blend-screen" />
      <span className="size-3.5 rounded-full bg-lb-blue mix-blend-screen" />
    </span>
  )
}

export function Brand({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <TriDots />
      <span className="text-lg font-extrabold tracking-[0.18em] text-foreground">
        SPINE
      </span>
    </span>
  )
}
