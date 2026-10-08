#if DEBUG
  import Foundation

  /// Launch arguments for driving the app from the command line (simulator
  /// screenshots, UI checks). Debug builds only. Launch arguments land in
  /// UserDefaults, so `-SpineTab stats` reads as the "SpineTab" default.
  ///
  ///   -SpineResetSession YES                  start signed out (UI tests)
  ///   -SpineServer http://localhost:3000 -SpineEmail a@b.c -SpinePassword …
  ///       sign in when no session is stored
  ///   -SpineTab collection|shelves|wishlist|stats|oracle
  ///   -SpineOpen film:<id> | person:<name> | shelf-check[:<shelf id>]
  ///                                           push onto the starting tab
  ///   -SpineSheet add|scan|settings            present a sheet
  enum DebugLaunch {
    private static var defaults: UserDefaults { .standard }

    static var resetsSession: Bool { defaults.bool(forKey: "SpineResetSession") }

    /// Signs in with the launch-argument credentials, if any were given.
    static func signIn(using auth: AuthStore) async -> Bool {
      guard let server = defaults.string(forKey: "SpineServer"),
        let email = defaults.string(forKey: "SpineEmail"),
        let password = defaults.string(forKey: "SpinePassword")
      else { return false }
      do {
        try await auth.signIn(server: server, email: email, password: password)
        return true
      } catch {
        print("DebugLaunch sign-in failed: \(error.userMessage)")
        return false
      }
    }

    static func apply(to router: Router) {
      if let tab = defaults.string(forKey: "SpineTab").flatMap(AppTab.init(rawValue:)) {
        router.tab = tab
      }
      if let open = defaults.string(forKey: "SpineOpen") {
        let parts = open.split(separator: ":", maxSplits: 1).map(String.init)
        if open == "shelf-check" {
          router.open(.shelfCheck(shelfID: nil))
        } else if parts.count == 2 {
          switch parts[0] {
          case "film": router.open(.film(id: parts[1]))
          case "person": router.open(.person(name: parts[1]))
          case "shelf-check": router.open(.shelfCheck(shelfID: parts[1]))
          default: break
          }
        }
      }
      switch defaults.string(forKey: "SpineSheet") {
      case "add": router.sheet = .addFilm(scan: false)
      case "scan": router.sheet = .addFilm(scan: true)
      case "settings": router.sheet = .settings
      default: break
      }
    }
  }
#endif
