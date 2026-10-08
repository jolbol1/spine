# Spine for iOS

A native SwiftUI app for iOS 26, with the same features as the web app. It
talks to the same Spine server, so you sign in with the account you use on
the web, and your collection, wishlist, shelves, and saved views are shared.

## Run it

1. Open `ios/Spine.xcodeproj` in Xcode 26 or later.
2. Pick an iPhone simulator or your device and press Run. On a device, set
   your team under Signing & Capabilities first.
3. Enter your server's address on the sign-in screen, e.g.
   `https://spine.example.com`, or `192.168.1.20:3000` for a server on your
   network. Bare LAN addresses default to `http://`.

Barcode scanning uses the camera (VisionKit), so it needs a device. The
simulator falls back to typing the barcode in. Scanning a front cover uses
VisionKit's document camera on a device; the simulator picks a photo and
crops it to the case's proportions instead. Shelf check (photos of disc
spines) needs `ANTHROPIC_API_KEY` set on the server.

## How it talks to the server

- **Auth** — better-auth's `bearer()` plugin. `POST /api/auth/sign-in/email`
  returns the session token in the `set-auth-token` header. The app keeps it
  in the Keychain and sends it as `Authorization: Bearer <token>`. It's the
  same session a browser holds as a cookie, so one account works in both
  places. The app never sends cookies: a cookie without an `Origin` header
  trips better-auth's CSRF check.
- **Data** — `POST /api/v1/<name>` with a JSON body calls the server
  function of that name (`src/routes/api/v1/$.ts`). It runs the same
  middleware, validator, and row-level-security-scoped handler as the web.
  `ios/Spine/Core/Endpoints.swift` has a typed wrapper for each one.
- **Covers** — a front cover scanned in the app is uploaded with
  `uploadCover` and saved on the film as a relative path,
  `/api/covers/<id>`, which the app resolves against the signed-in server
  (`Helpers/CoverURL.swift`).

`tests/e2e/native-api.e2e.ts` covers that contract from the server side.

## Layout

```
Spine/
  App/        entry point, tab bar, router, debug launch arguments
  Core/       API client and endpoints, auth, Library (the shared data store), toasts
  Models/     Codable mirrors of the server's rows and results
  Helpers/    film helpers and formatters shared with the web
  Design/     theme, poster/card components, cached images
  Features/   one folder per screen: Collection, Film (detail, form, add,
              scan), Shelves, ShelfCheck, Wishlist, Stats, Oracle, People,
              Settings, Auth
SpineUITests/ end-to-end UI tests against a running server
UITestMedia/  a photo the shelf-check UI tests read
```

The project uses Xcode's synchronized folders, so files added under
`Spine/` or `SpineUITests/` are picked up without editing the project.

## UI tests

The UI tests drive the real app against a running server. Each test signs
up its own account through the server's auth API, so they need no seeded
data.

```bash
# from the repo root, with the server running on :3000
cd ios
TEST_RUNNER_SPINE_SERVER=http://localhost:3000 xcodebuild test \
  -project Spine.xcodeproj -scheme Spine \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro'
```

The photo tests pick the newest photo in the simulator's library. The
simulator has no document camera, so cover scans go through the photo
fallback and any photo works. The shelf-check tests that need a real
reading skip when the server has no `ANTHROPIC_API_KEY`. The order check
also needs the synthetic shelf in `UITestMedia` to be the newest photo:

```bash
xcrun simctl addmedia 'iPhone 17 Pro' ios/UITestMedia/shelf-bluray.jpg
```

`testAShelfCheckShowsWhyAPhotoCouldntBeRead` is the reverse: it checks the
missing-key error, so it skips against a server that can read photos.

## Debug launch arguments

Debug builds accept launch arguments for automation (`App/DebugLaunch.swift`):

| Argument | Effect |
| --- | --- |
| `-SpineResetSession YES` | Start signed out. |
| `-SpineServer <url> -SpineEmail <email> -SpinePassword <pw>` | Sign in when no session is stored. |
| `-SpineTab collection\|shelves\|wishlist\|stats\|oracle` | The starting tab. |
| `-SpineOpen film:<id>` / `person:<name>` / `shelf-check[:<shelf id>]` | Push a screen onto the starting tab. |
| `-SpineSheet add\|scan\|settings` | Present a sheet. |
