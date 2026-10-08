/**
 * A router-free stand-in for TanStack Router's `Link`, so unit tests can
 * render pages and components without a router. It renders the plain
 * anchor the real one would: path params filled in, search as a query.
 *
 *   vi.mock("@tanstack/react-router", async (importOriginal) => ({
 *     ...(await importOriginal<object>()),
 *     Link: (await import("@/test/link-stub")).LinkStub,
 *   }))
 */
export function LinkStub({
  to = "",
  params,
  search,
  children,
  // Router-only props, dropped so they don't land on the anchor.
  activeOptions: _activeOptions,
  activeProps: _activeProps,
  preload: _preload,
  replace: _replace,
  ...anchor
}: Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  to?: string
  params?: Record<string, string>
  search?: Record<string, string | undefined>
  activeOptions?: unknown
  activeProps?: unknown
  preload?: unknown
  replace?: boolean
}) {
  const path = Object.entries(params ?? {}).reduce(
    (built, [key, value]) => built.replace(`$${key}`, value),
    to
  )
  const query = new URLSearchParams(
    Object.entries(search ?? {}).filter(
      (entry): entry is [string, string] => entry[1] !== undefined
    )
  ).toString()
  return (
    <a href={query ? `${path}?${query}` : path} {...anchor}>
      {children}
    </a>
  )
}
