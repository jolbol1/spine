import Foundation

/// Server functions report expected failures in-band rather than with an
/// HTTP error: `{ ok: false, error }` or `{ success: false, error }`. A
/// success either wraps its payload in `data` or spreads it at the top level.
nonisolated enum Outcome<Value: Decodable & Sendable>: Decodable, Sendable {
  case success(Value)
  case failure(String)

  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: Keys.self)
    let ok =
      try c.decodeIfPresent(Bool.self, forKey: .ok)
      ?? c.decodeIfPresent(Bool.self, forKey: .success)
      ?? true
    if !ok {
      self = .failure(
        try c.decodeIfPresent(String.self, forKey: .error)
          ?? "Something went wrong"
      )
    } else if c.contains(.data) {
      self = .success(try c.decode(Value.self, forKey: .data))
    } else {
      self = .success(try Value(from: decoder))
    }
  }

  /// The payload, or an `APIError.rejected` carrying the server's message.
  func get() throws -> Value {
    switch self {
    case .success(let value): value
    case .failure(let message): throw APIError.rejected(message)
    }
  }

  private enum Keys: String, CodingKey { case ok, success, data, error }
}

/// An `Outcome` success with nothing in it beyond the flag. (Not `Empty`,
/// which Combine already exports.)
nonisolated struct Acknowledged: Decodable, Hashable, Sendable {}

/// `updateFilm` answers with the row, `{ error }` for a TMDB id that matches
/// nothing, or null when the film is gone.
nonisolated enum FilmUpdate: Decodable, Sendable {
  case updated(Film)
  case failed(String)

  init(from decoder: Decoder) throws {
    let single = try decoder.singleValueContainer()
    if single.decodeNil() {
      self = .failed("This film is no longer in your collection.")
      return
    }
    let c = try decoder.container(keyedBy: Keys.self)
    if let error = try c.decodeIfPresent(String.self, forKey: .error) {
      self = .failed(error)
    } else {
      self = .updated(try Film(from: decoder))
    }
  }

  private enum Keys: String, CodingKey { case error }
}
