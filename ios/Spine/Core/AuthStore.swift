import Foundation
import Observation

/// Who is signed in, to which server. The token is a better-auth session —
/// the same one a browser holds as a cookie — so an account works on the
/// web and in the app alike.
@Observable
final class AuthStore {
  enum Phase: Equatable {
    /// Checking a stored token with the server.
    case restoring
    case signedOut
    case signedIn(SessionUser)
  }

  private(set) var phase: Phase = .restoring
  /// The data for the signed-in account; a fresh one per sign-in, so
  /// nothing leaks between accounts.
  private(set) var library: Library?
  /// Shown on the sign-in screen after the server rejected a stored token.
  private(set) var notice: String?

  /// The last server signed in to — prefilled on the sign-in screen.
  var lastServer: String {
    UserDefaults.standard.string(forKey: Keys.server) ?? ""
  }

  private enum Keys {
    static let server = "spine.server"
    static let user = "spine.user"
    static let token = "session-token"
  }

  /// Check the stored session. A server we can't reach keeps the cached
  /// user signed in, so the app still opens offline.
  func restore() async {
    #if DEBUG
      if DebugLaunch.resetsSession {
        Keychain.delete(Keys.token)
        UserDefaults.standard.removeObject(forKey: Keys.server)
      }
    #endif
    guard let server = URL(string: lastServer), let token = Keychain.read(Keys.token)
    else {
      #if DEBUG
        if await DebugLaunch.signIn(using: self) { return }
      #endif
      phase = .signedOut
      return
    }
    let client = makeClient(server: server, token: token)
    do {
      if let user = try await client.session() {
        begin(user: user, client: client)
      } else {
        clearSession(notice: "Your session has expired — sign in again.")
      }
    } catch APIError.unauthorized {
      clearSession(notice: "Your session has expired — sign in again.")
    } catch {
      if let cached = cachedUser() {
        begin(user: cached, client: client)
      } else {
        clearSession(notice: error.userMessage)
      }
    }
  }

  func signIn(server: String, email: String, password: String) async throws {
    let url = try Self.normalize(server)
    let (token, user) = try await APIClient.signIn(
      server: url, email: email.trimmingCharacters(in: .whitespaces), password: password)
    store(server: url, token: token, user: user)
  }

  func signUp(server: String, name: String, email: String, password: String) async throws {
    let url = try Self.normalize(server)
    let (token, user) = try await APIClient.signUp(
      server: url, name: name.trimmingCharacters(in: .whitespaces),
      email: email.trimmingCharacters(in: .whitespaces), password: password)
    store(server: url, token: token, user: user)
  }

  func signOut() async {
    let client = library?.api
    clearSession(notice: nil)
    await client?.signOut()
  }

  /// The server rejected the token mid-session (revoked, expired).
  func sessionExpired() {
    guard case .signedIn = phase else { return }
    clearSession(notice: "Your session has expired — sign in again.")
  }

  // MARK: Private

  private func store(server: URL, token: String, user: SessionUser) {
    UserDefaults.standard.set(server.absoluteString, forKey: Keys.server)
    Keychain.write(token, for: Keys.token)
    begin(user: user, client: makeClient(server: server, token: token))
  }

  private func begin(user: SessionUser, client: APIClient) {
    if let data = try? JSONEncoder().encode(user) {
      UserDefaults.standard.set(data, forKey: Keys.user)
    }
    notice = nil
    library = Library(api: client, userID: user.id)
    phase = .signedIn(user)
  }

  private func clearSession(notice: String?) {
    Keychain.delete(Keys.token)
    UserDefaults.standard.removeObject(forKey: Keys.user)
    library?.discardCache()
    library = nil
    self.notice = notice
    phase = .signedOut
  }

  private func cachedUser() -> SessionUser? {
    UserDefaults.standard.data(forKey: Keys.user)
      .flatMap { try? JSONDecoder().decode(SessionUser.self, from: $0) }
  }

  private func makeClient(server: URL, token: String) -> APIClient {
    APIClient(server: server, token: token) { [weak self] in
      Task { @MainActor in self?.sessionExpired() }
    }
  }

  /// "spine.example.com" → https://spine.example.com; bare LAN addresses
  /// ("192.168.1.20:3000", "nas.local:3000", "localhost:3000") get http,
  /// since a home server rarely has a certificate.
  static func normalize(_ raw: String) throws -> URL {
    var text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    while text.hasSuffix("/") { text.removeLast() }
    guard !text.isEmpty else { throw APIError.rejected("Enter your Spine server's address.") }
    if !text.contains("://") {
      let host = text.split(separator: ":").first.map(String.init) ?? text
      let isLocal =
        host == "localhost" || host.hasSuffix(".local")
        || host.allSatisfy { $0.isNumber || $0 == "." }
      text = (isLocal ? "http://" : "https://") + text
    }
    guard let url = URL(string: text), let scheme = url.scheme?.lowercased(),
      scheme == "http" || scheme == "https", url.host() != nil
    else { throw APIError.badServerURL }
    return url
  }
}
