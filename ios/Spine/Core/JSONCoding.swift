import Foundation

/// JSON as the Spine server speaks it: drizzle timestamps serialise as
/// ISO-8601 with milliseconds ("2026-10-08T16:01:50.862Z").
nonisolated enum JSONCoding {
  static func decoder() -> JSONDecoder {
    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .custom { decoder in
      let container = try decoder.singleValueContainer()
      let raw = try container.decode(String.self)
      if let date = parseDate(raw) { return date }
      throw DecodingError.dataCorruptedError(
        in: container, debugDescription: "Unrecognised date: \(raw)")
    }
    return decoder
  }

  static func encoder() -> JSONEncoder {
    let encoder = JSONEncoder()
    encoder.dateEncodingStrategy = .custom { date, encoder in
      var container = encoder.singleValueContainer()
      try container.encode(isoString(date))
    }
    return encoder
  }

  static func parseDate(_ raw: String) -> Date? {
    (try? Date.ISO8601FormatStyle(includingFractionalSeconds: true).parse(raw))
      ?? (try? Date.ISO8601FormatStyle().parse(raw))
  }

  /// "2026-10-08T16:01:50.862Z" — the form the server's `z.iso.datetime()`
  /// accepts (e.g. `Shelf.arrangedAt`).
  static func isoString(_ date: Date) -> String {
    date.formatted(Date.ISO8601FormatStyle(includingFractionalSeconds: true))
  }
}
