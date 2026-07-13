import {
  Link,
  Outlet,
  createFileRoute,
  redirect,
  useRouter,
} from "@tanstack/react-router"
import { LogOut, ScanBarcode } from "lucide-react"
import { Brand } from "@/components/brand"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { signOut } from "@/lib/auth-client"

export const Route = createFileRoute("/_app")({
  beforeLoad: ({ context }) => {
    if (!context.user) throw redirect({ to: "/login" })
    return { user: context.user }
  },
  component: AppLayout,
})

const navLinks = [
  { to: "/", label: "Collection" },
  { to: "/wishlist", label: "Wishlist" },
  { to: "/stats", label: "Stats" },
  { to: "/oracle", label: "Oracle" },
] as const

function AppLayout() {
  const { user } = Route.useRouteContext()
  const router = useRouter()

  async function handleSignOut() {
    await signOut()
    await router.invalidate()
    await router.navigate({ to: "/login" })
  }

  return (
    <div className="flex min-h-svh flex-col">
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-6 px-4">
          <Link to="/" aria-label="Spine home">
            <Brand />
          </Link>
          <nav className="hidden items-center gap-1 sm:flex">
            {navLinks.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                activeOptions={{ exact: link.to === "/" }}
                className="rounded-md px-3 py-1.5 text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase transition-colors hover:text-foreground"
                activeProps={{ className: "text-foreground" }}
              >
                {link.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="gap-2"
              render={<Link to="/add" search={{ scan: "1" }} />}
            >
              <ScanBarcode className="size-4" />
              <span className="hidden sm:inline">Scan</span>
            </Button>
            <Button size="sm" render={<Link to="/add" />}>
              Add film
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <button
                    type="button"
                    aria-label="Account menu"
                    className="rounded-full"
                  />
                }
              >
                <Avatar className="size-8">
                  <AvatarFallback className="bg-secondary text-xs font-bold">
                    {user.name.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>
                    <div className="text-sm font-medium">{user.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {user.email}
                    </div>
                  </DropdownMenuLabel>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  render={<Link to="/settings">Settings</Link>}
                />
                <DropdownMenuItem onClick={handleSignOut}>
                  <LogOut className="size-4" /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <nav className="flex items-center justify-center gap-1 border-t border-border/60 px-2 py-1 sm:hidden">
          {navLinks.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              activeOptions={{ exact: link.to === "/" }}
              className="rounded-md px-3 py-1.5 text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase hover:text-foreground"
              activeProps={{ className: "text-foreground" }}
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <Outlet />
      </main>
      <footer className="border-t border-border/60 py-6 text-center text-xs text-muted-foreground">
        Spine — your physical media, catalogued.
      </footer>
    </div>
  )
}
