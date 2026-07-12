import { queryOptions } from "@tanstack/react-query"
import { getFilmFn, listFilmsFn } from "@/server/films"
import { getSettingsFn } from "@/server/settings"
import { listWishlistFn } from "@/server/wishlist"

export const filmsQuery = queryOptions({
  queryKey: ["films"],
  queryFn: () => listFilmsFn(),
})

export const filmQuery = (id: string) =>
  queryOptions({
    queryKey: ["films", id],
    queryFn: () => getFilmFn({ data: { id } }),
  })

export const wishlistQuery = queryOptions({
  queryKey: ["wishlist"],
  queryFn: () => listWishlistFn(),
})

export const settingsQuery = queryOptions({
  queryKey: ["settings"],
  queryFn: () => getSettingsFn(),
})
