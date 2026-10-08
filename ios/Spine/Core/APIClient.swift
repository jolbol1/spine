import Foundation

/// The signed-in user, as `session` and the auth endpoints report it.
nonisolated struct SessionUser: Codable, Hashable, Sendable {
  var id: String
  var name: String
  var email: String
}

/// Talks to a Spine server: better-auth for sign-in, then the server
/// functions the web UI uses, exposed as JSON at `/api/v1/<name>`
/// (src/routes/api/v1/$.ts). Requests carry the session as a bearer token and
/// never cookies — a cookie without an Origin header trips better-auth's
/// CSRF check.
nonisolated struct APIClient: Sendable {
  let server: URL
  let token: String?
  /// Called when the server rejects the token, so the app can sign out.
  var onUnauthorized: (@Sendable () -> Void)?

  /// Long enough for the whole-collection backfills, which the server runs
  /// to completion before answering.
  static let backfillTimeout: TimeInterval = 900

  private static let session: URLSession = {
    let config = URLSessionConfiguration.default
    config.httpCookieStorage = nil
    config.httpShouldSetCookies = false
    config.httpCookieAcceptPolicy = .never
    config.urlCache = nil
    config.timeoutIntervalForRequest = 60
    config.waitsForConnectivity = false
    return URLSession(configuration: config)
  }()

  // MARK: Server functions

  /// Call a server function that takes no input.
  func call<Output: Decodable>(
    _ name: String, timeout: TimeInterval = 60
  ) async throws -> Output {
    try await send(path: "api/v1/\(name)", body: nil, timeout: timeout)
  }

  /// Call a server function with `input` as its JSON body.
  func call<Output: Decodable>(
    _ name: String, _ input: some Encodable, timeout: TimeInterval = 60
  ) async throws -> Output {
    let body: Data
    do {
      body = try JSONCoding.encoder().encode(input)
    } catch {
      throw APIError.decoding("Couldn't encode \(name) input: \(error)")
    }
    return try await send(path: "api/v1/\(name)", body: body, timeout: timeout)
  }

  // MARK: Auth

  /// `POST /api/auth/sign-in/email` — returns the bearer token.
  static func signIn(
    server: URL, email: String, password: String
  ) async throws -> (token: String, user: SessionUser) {
    try await authenticate(
      server: server, path: "api/auth/sign-in/email",
      body: ["email": email, "password": password])
  }

  /// `POST /api/auth/sign-up/email` — creates the account and signs in.
  static func signUp(
    server: URL, name: String, email: String, password: String
  ) async throws -> (token: String, user: SessionUser) {
    try await authenticate(
      server: server, path: "api/auth/sign-up/email",
      body: ["name": name, "email": email, "password": password])
  }

  /// Revoke this session server-side. Best effort: a failure still leaves
  /// the app signed out locally.
  func signOut() async {
    _ = try? await rawRequest(path: "api/auth/sign-out", body: Data("{}".utf8), timeout: 15)
  }

  // MARK: Plumbing

  private func send<Output: Decodable>(
    path: String, body: Data?, timeout: TimeInterval
  ) async throws -> Output {
    let (data, response) = try await rawRequest(path: path, body: body, timeout: timeout)
    switch response.statusCode {
    case 200..<300:
      do {
        return try JSONCoding.decoder().decode(Output.self, from: data)
      } catch {
        throw APIError.decoding(Self.describe(error))
      }
    case 401:
      onUnauthorized?()
      throw APIError.unauthorized
    case 400..<500:
      throw APIError.rejected(Self.message(in: data) ?? "The server rejected that request.")
    default:
      throw APIError.server(status: response.statusCode)
    }
  }

  private func rawRequest(
    path: String, body: Data?, timeout: TimeInterval
  ) async throws -> (Data, HTTPURLResponse) {
    var request = URLRequest(url: server.appending(path: path))
    request.httpMethod = "POST"
    request.timeoutInterval = timeout
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    if let body {
      request.httpBody = body
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    }
    if let token {
      request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    }
    return try await Self.perform(request)
  }

  private static func authenticate(
    server: URL, path: String, body: [String: String]
  ) async throws -> (token: String, user: SessionUser) {
    var request = URLRequest(url: server.appending(path: path))
    request.httpMethod = "POST"
    request.timeoutInterval = 30
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try JSONEncoder().encode(body)
    let (data, response) = try await perform(request)

    guard (200..<300).contains(response.statusCode) else {
      if response.statusCode >= 500 { throw APIError.server(status: response.statusCode) }
      throw APIError.rejected(message(in: data) ?? "Sign in failed.")
    }
    guard let token = response.value(forHTTPHeaderField: "set-auth-token"), !token.isEmpty
    else {
      throw APIError.rejected(
        "This server didn't issue an app token. Update Spine on the server to a version with iOS support."
      )
    }
    struct AuthResponse: Decodable { var user: SessionUser }
    do {
      let user = try JSONCoding.decoder().decode(AuthResponse.self, from: data).user
      return (token, user)
    } catch {
      throw APIError.decoding(describe(error))
    }
  }

  private static func perform(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    do {
      let (data, response) = try await session.data(for: request)
      guard let http = response as? HTTPURLResponse else {
        throw APIError.transport("The server sent an unexpected response.")
      }
      return (data, http)
    } catch let error as APIError {
      throw error
    } catch let error as URLError where error.code == .cancelled {
      // A cancelled task cancels its request; that's not a failure to report.
      throw CancellationError()
    } catch let error as URLError {
      throw APIError.transport(transportMessage(error))
    } catch is CancellationError {
      throw CancellationError()
    } catch {
      throw APIError.transport(error.localizedDescription)
    }
  }

  private static func transportMessage(_ error: URLError) -> String {
    switch error.code {
    case .notConnectedToInternet, .networkConnectionLost:
      "You're offline."
    case .timedOut:
      "The Spine server took too long to answer."
    case .cannotFindHost, .cannotConnectToHost, .dnsLookupFailed:
      "Can't reach the Spine server. Check the address and that it's running."
    default:
      error.localizedDescription
    }
  }

  /// better-auth answers `{ message }`, the API route `{ error }`.
  private static func message(in data: Data) -> String? {
    guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else {
      let text = String(decoding: data, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
      return text.isEmpty || text.count > 200 ? nil : text
    }
    return (object["error"] as? String) ?? (object["message"] as? String)
  }

  private static func describe(_ error: Error) -> String {
    switch error as? DecodingError {
    case .keyNotFound(let key, let context)?:
      "missing \(context.codingPath.map(\.stringValue).joined(separator: ".")).\(key.stringValue)"
    case .typeMismatch(_, let context)?, .valueNotFound(_, let context)?,
      .dataCorrupted(let context)?:
      "bad value at \(context.codingPath.map(\.stringValue).joined(separator: "."))"
    default:
      error.localizedDescription
    }
  }
}
