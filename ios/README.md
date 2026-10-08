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
simulator falls back to typing the barcode in.

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
              scan), Shelves, Wishlist, Stats, Oracle, People, Settings, Auth
SpineUITests/ end-to-end UI tests against a running server
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

## Debug launch arguments

Debug builds accept launch arguments for automation (`App/DebugLaunch.swift`):

| Argument | Effect |
| --- | --- |
| `-SpineResetSession YES` | Start signed out. |
| `-SpineServer <url> -SpineEmail <email> -SpinePassword <pw>` | Sign in when no session is stored. |
| `-SpineTab collection\|shelves\|wishlist\|stats\|oracle` | The starting tab. |
| `-SpineOpen film:<id>` / `person:<name>` | Push a screen onto the starting tab. |
| `-SpineSheet add\|scan\|settings` | Present a sheet. |
