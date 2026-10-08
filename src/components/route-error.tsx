import { useQueryClient } from "@tanstack/react-query"
import { useRouter } from "@tanstack/react-router"
import type { ErrorComponentProps } from "@tanstack/react-router"
import { RotateCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"

/**
 * Every route's error boundary: a failed load (loader or suspending
 * query) lands here instead of the router's default screen, with a
 * retry that refetches rather than stranding the user.
 */
export function RouteErrorScreen({ error }: ErrorComponentProps) {
  const router = useRouter()
  const queryClient = useQueryClient()

  const retry = () => {
    // Failed queries keep serving their cached error — reset them so
    // the re-run loaders actually refetch.
    queryClient.resetQueries()
    router.invalidate()
  }

  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>Something went wrong</EmptyTitle>
        <EmptyDescription>
          This page's data could not be loaded. Try again — if it keeps failing,
          the server may be down.
        </EmptyDescription>
      </EmptyHeader>
      <Button className="gap-2" onClick={retry}>
        <RotateCw className="size-4" /> Try again
      </Button>
      {error instanceof Error && error.message && (
        <p className="max-w-md truncate font-mono text-xs text-muted-foreground">
          {error.message}
        </p>
      )}
    </Empty>
  )
}
