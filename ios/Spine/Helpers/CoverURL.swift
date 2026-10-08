import Foundation
import Synchronization

/// Turns a stored cover string into a URL. Covers photographed into the
/// server's own store are saved as a relative path, `/api/covers/<uuid>`
/// (src/lib/covers.ts), so they keep working if the server's address
/// changes; those resolve against the signed-in server. Everything else is
/// an absolute link to a cover host.
nonisolated enum CoverURL {
  /// The signed-in server. `AuthStore` sets it on sign-in and clears it on
  /// sign-out; image loads read it from any thread.
  private static let server = Mutex<URL?>(nil)

  static func setServer(_ url: URL?) {
    server.withLock { $0 = url }
  }

  /// The URL to load `raw` from, or nil when it's blank — or relative with
  /// no server to resolve it against.
  static func resolve(_ raw: String?) -> URL? {
    guard let text = raw?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty
    else { return nil }
    if text.hasPrefix("/"), !text.hasPrefix("//") {
      // Appended like the API client's paths, so a server behind a path
      // prefix works too.
      return server.withLock { $0 }?.appending(path: String(text.dropFirst()))
    }
    return URL(string: text)
  }
}

nonisolated extension WishlistItem {
  var coverURL: URL? { CoverURL.resolve(coverUrl) }
}
