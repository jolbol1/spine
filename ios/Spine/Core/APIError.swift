import Foundation

nonisolated enum APIError: LocalizedError, Sendable, Equatable {
  /// The server address couldn't be turned into a URL.
  case badServerURL
  /// The session token is missing, expired, or revoked.
  case unauthorized
  /// The server understood the request and declined it, with a message meant
  /// for the user — an in-band `{ ok: false, error }`, a validation failure,
  /// or a wrong password.
  case rejected(String)
  /// The server failed (5xx, or a status the client doesn't expect).
  case server(status: Int)
  /// The request never completed — offline, unreachable host, timeout.
  case transport(String)
  /// The response wasn't the shape this app version expects.
  case decoding(String)

  var errorDescription: String? {
    switch self {
    case .badServerURL:
      "That server address isn't a valid URL."
    case .unauthorized:
      "Your session has expired — sign in again."
    case .rejected(let message):
      message
    case .server(let status):
      "The Spine server had a problem (HTTP \(status))."
    case .transport(let message):
      message
    case .decoding(let detail):
      "The server sent something this app doesn't understand. (\(detail))"
    }
  }
}

extension Error {
  /// The message to show the user for any error thrown by the API layer.
  nonisolated var userMessage: String {
    (self as? LocalizedError)?.errorDescription ?? localizedDescription
  }
}
