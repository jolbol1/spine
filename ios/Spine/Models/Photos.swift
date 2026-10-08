import Foundation

/// One disc spine read off a shelf photo, with its verdict against the
/// collection — `ShelfSpine` in src/lib/shelf-reading.ts.
nonisolated struct ShelfSpine: Decodable, Hashable, Sendable {
  enum Legibility: String, Sendable {
    /// The title reads with confidence.
    case clear
    /// Partly hidden or blurred, but fairly sure.
    case partial
    /// A guess.
    case unclear
  }

  enum Status: String, Sendable {
    /// Catalogued — in this format, when the spine shows one.
    case owned
    /// Catalogued, but only in another format than the spine shows.
    case otherFormat = "other-format"
    /// Not in the collection.
    case missing
  }

  /// The catalogued film an owned or other-format spine points at.
  struct MatchedFilm: Decodable, Hashable, Sendable {
    var id: String
    var title: String
    var year: Int?
    var format: String
    var coverUrl: String?

    var coverURL: URL? { CoverURL.resolve(coverUrl) }
  }

  /// The spine's words as printed.
  var text: String
  /// The film or series, as it would be catalogued.
  var title: String
  var year: Int?
  /// "4K UHD" | "Blu-ray" | "DVD", when the spine shows it.
  var format: String?
  /// The publisher (Criterion, Arrow, …).
  var label: String?
  var spineNumber: Int?
  var legibility: Legibility
  var status: Status
  var film: MatchedFilm?

  init(
    text: String, title: String, year: Int? = nil, format: String? = nil,
    label: String? = nil, spineNumber: Int? = nil, legibility: Legibility = .clear,
    status: Status = .missing, film: MatchedFilm? = nil
  ) {
    self.text = text
    self.title = title
    self.year = year
    self.format = format
    self.label = label
    self.spineNumber = spineNumber
    self.legibility = legibility
    self.status = status
    self.film = film
  }

  // A value this app version doesn't know reads as the cautious one, rather
  // than failing the whole photo.
  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    text = try c.decodeIfPresent(String.self, forKey: .text) ?? ""
    title = try c.decode(String.self, forKey: .title)
    year = try c.decodeIfPresent(Int.self, forKey: .year)
    format = try c.decodeIfPresent(String.self, forKey: .format)
    label = try c.decodeIfPresent(String.self, forKey: .label)
    spineNumber = try c.decodeIfPresent(Int.self, forKey: .spineNumber)
    legibility =
      try c.decodeIfPresent(String.self, forKey: .legibility).flatMap(Legibility.init) ?? .unclear
    status = try c.decodeIfPresent(String.self, forKey: .status).flatMap(Status.init) ?? .missing
    film = try c.decodeIfPresent(MatchedFilm.self, forKey: .film)
  }

  private enum CodingKeys: String, CodingKey {
    case text, title, year, format, label, spineNumber, legibility, status, film
  }
}

/// `scanShelfPhoto` success: every spine read off one photo.
nonisolated struct ShelfPhotoReading: Decodable, Hashable, Sendable {
  var spines: [ShelfSpine]
}

/// `uploadCover` success: the relative URL to put in a film's cover field.
nonisolated struct UploadedCover: Decodable, Hashable, Sendable {
  /// "/api/covers/<uuid>"
  var url: String
}
