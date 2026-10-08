import { createFileRoute } from "@tanstack/react-router"
import { lookupSpineFn, syncCriterionSpinesFn } from "@/server/criterion"
import { importCexFn } from "@/server/cex"
import { importBlurayUrlFn, searchBlurayFn } from "@/server/bluray"
import {
  createFilmFn,
  deleteFilmFn,
  getFilmFn,
  listFilmsFn,
  setWatchedOverrideFn,
  updateFilmFn,
} from "@/server/films"
import { syncLetterboxdFn, syncLetterboxdHistoryFn } from "@/server/letterboxd"
import {
  refreshRtScoresFn,
  syncRottenTomatoesFn,
} from "@/server/rottentomatoes"
import { getSessionFn } from "@/server/session"
import {
  getSettingsFn,
  saveSettingsFn,
  saveShelvesFn,
  saveViewsFn,
} from "@/server/settings"
import {
  getPersonImdbFn,
  rematchTmdbFn,
  syncTmdbCastFn,
  syncTmdbDetailsFn,
} from "@/server/tmdb"
import { searchWebBarcodeFn } from "@/server/websearch"
import {
  createWishlistItemFn,
  deleteWishlistItemFn,
  listWishlistFn,
  moveToCollectionFn,
  scrapeWishlistUrlFn,
} from "@/server/wishlist"

type ApiFunction = (opts: { data: unknown }) => Promise<unknown>

/**
 * The server functions the web UI calls, reachable as plain JSON for native
 * clients (the iOS app): `POST /api/v1/<name>` with the function's input as
 * the JSON body, or `GET` for functions without one. Each call runs the same
 * middleware, validator, and RLS-scoped handler as the web, so both clients
 * see one account and one behaviour.
 *
 * Authenticate with `Authorization: Bearer <token>`, where the token is the
 * `set-auth-token` header from `POST /api/auth/sign-in/email`. The session
 * cookie alone is refused (see `handle`).
 */
const API_FUNCTIONS = new Map<string, ApiFunction>(
  Object.entries({
    session: getSessionFn,

    listFilms: listFilmsFn,
    getFilm: getFilmFn,
    createFilm: createFilmFn,
    updateFilm: updateFilmFn,
    deleteFilm: deleteFilmFn,
    setWatchedOverride: setWatchedOverrideFn,

    listWishlist: listWishlistFn,
    createWishlistItem: createWishlistItemFn,
    deleteWishlistItem: deleteWishlistItemFn,
    moveToCollection: moveToCollectionFn,
    scrapeWishlistUrl: scrapeWishlistUrlFn,

    getSettings: getSettingsFn,
    saveSettings: saveSettingsFn,
    saveViews: saveViewsFn,
    saveShelves: saveShelvesFn,

    searchBluray: searchBlurayFn,
    importBlurayUrl: importBlurayUrlFn,
    importCex: importCexFn,
    searchWebBarcode: searchWebBarcodeFn,
    lookupSpine: lookupSpineFn,

    rematchTmdb: rematchTmdbFn,
    refreshRtScores: refreshRtScoresFn,
    getPersonImdb: getPersonImdbFn,

    syncLetterboxd: syncLetterboxdFn,
    syncLetterboxdHistory: syncLetterboxdHistoryFn,
    syncTmdbCast: syncTmdbCastFn,
    syncTmdbDetails: syncTmdbDetailsFn,
    syncRottenTomatoes: syncRottenTomatoesFn,
    syncCriterionSpines: syncCriterionSpinesFn,
  }) as Array<[string, ApiFunction]>
)

async function handle({
  request,
  params,
}: {
  request: Request
  params: { _splat?: string }
}): Promise<Response> {
  const fn = API_FUNCTIONS.get(params._splat ?? "")
  if (!fn) {
    return Response.json({ error: "Unknown endpoint" }, { status: 404 })
  }

  // Bearer only. The handlers would also accept the session cookie, and this
  // route parses any body as JSON, so a cookie-carrying cross-site form post
  // could otherwise act as the user. A page can't attach an Authorization
  // header to another origin without a CORS preflight, which this server
  // never grants.
  if (!/^bearer\s+\S/i.test(request.headers.get("authorization") ?? "")) {
    return Response.json({ error: "Bearer token required" }, { status: 401 })
  }

  let data: unknown = undefined
  if (request.method === "POST") {
    const body = await request.text()
    if (body.trim() !== "") {
      try {
        data = JSON.parse(body)
      } catch {
        return Response.json({ error: "Body must be JSON" }, { status: 400 })
      }
    }
  }

  try {
    return Response.json((await fn({ data })) ?? null)
  } catch (err) {
    // authMiddleware rejects with a ready-made 401 response.
    if (err instanceof Response) return err
    const issues = validationIssues(err)
    if (issues) {
      const message = issues
        .map((i) => (i.path?.length ? `${i.path.join(".")}: ` : "") + i.message)
        .join("; ")
      return Response.json({ error: message, issues }, { status: 400 })
    }
    console.error("[api] call failed", params._splat, err)
    return Response.json({ error: "Request failed" }, { status: 500 })
  }
}

interface ValidationIssue {
  path?: Array<string | number>
  message: string
}

/** Validator failures surface as an Error whose message is the issue list. */
function validationIssues(err: unknown): ValidationIssue[] | null {
  if (!(err instanceof Error)) return null
  try {
    const issues: unknown = JSON.parse(err.message)
    return Array.isArray(issues) ? (issues as ValidationIssue[]) : null
  } catch {
    return null
  }
}

export const Route = createFileRoute("/api/v1/$")({
  server: {
    handlers: {
      GET: handle,
      POST: handle,
    },
  },
})
