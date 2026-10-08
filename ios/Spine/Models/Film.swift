import Foundation

/// One disc in the collection — a `films` row as the server returns it
/// (src/db/schema.ts). Dates arrive as ISO-8601 strings; `pricePaid` is a
/// Postgres numeric, so it arrives as a decimal string.
nonisolated struct Film: Codable, Identifiable, Hashable, Sendable {
  let id: String
  var title: String
  /// Title with leading articles stripped, lowercased — for A–Z browse.
  var sortTitle: String
  var director: String?
  var year: Int?

  /// "4K UHD" | "Blu-ray" | "DVD"
  var format: String
  var audio: String?
  /// e.g. HDR10, Dolby Vision — nil means SDR.
  var hdr: String?
  var region: String?
  /// The publisher, e.g. Criterion, Arrow.
  var label: String?
  var edition: String?
  var packageType: String?
  var spineNumber: Int?
  var runtimeMinutes: Int?
  var discCount: Int

  var barcode: String?
  var coverUrl: String?
  var notes: String?
  var pricePaid: String?

  var tmdbId: Int?
  /// "movie" | "tv"
  var tmdbMediaType: String?
  var tmdbCast: [CastMember]?
  var tmdbDetails: TmdbDetails?

  var rtUrl: String?
  var rtCriticsScore: Int?
  var rtAudienceScore: Int?
  var rtSyncedAt: Date?

  var letterboxdWatched: Bool
  var letterboxdWatchedAt: Date?
  var letterboxdRating: Double?
  var letterboxdUri: String?
  var letterboxdReview: String?
  var letterboxdLiked: Bool?
  /// nil follows the Letterboxd sync; true/false pins the watched state.
  var watchedOverride: Bool?

  var createdAt: Date
  var updatedAt: Date
}

/// One credited performer, as stored in films.tmdb_cast.
nonisolated struct CastMember: Codable, Hashable, Sendable {
  var id: Int
  var name: String
  var character: String?
  var profilePath: String?

  var profileURL: URL? {
    profilePath.flatMap { URL(string: "https://image.tmdb.org/t/p/w185\($0)") }
  }
}

/// Title-level TMDB metadata, as stored in films.tmdb_details.
nonisolated struct TmdbDetails: Codable, Hashable, Sendable {
  var imdbId: String?
  var genres: [String]
  var productionCompanies: [String]
  var productionCountries: [String]
  var originalLanguage: String?
  /// USD; unknown is nil. Movies only.
  var budget: Double?
  var revenue: Double?
  /// TMDB community rating, 0–10.
  var voteAverage: Double?
  /// e.g. "The Godfather Collection".
  var collection: String?
  /// Age rating — GB preferred, US fallback (e.g. 15, PG).
  var certification: String?

  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    imdbId = try c.decodeIfPresent(String.self, forKey: .imdbId)
    genres = try c.decodeIfPresent([String].self, forKey: .genres) ?? []
    productionCompanies =
      try c.decodeIfPresent([String].self, forKey: .productionCompanies) ?? []
    productionCountries =
      try c.decodeIfPresent([String].self, forKey: .productionCountries) ?? []
    originalLanguage = try c.decodeIfPresent(String.self, forKey: .originalLanguage)
    budget = try c.decodeIfPresent(Double.self, forKey: .budget)
    revenue = try c.decodeIfPresent(Double.self, forKey: .revenue)
    voteAverage = try c.decodeIfPresent(Double.self, forKey: .voteAverage)
    collection = try c.decodeIfPresent(String.self, forKey: .collection)
    certification = try c.decodeIfPresent(String.self, forKey: .certification)
  }
}

/// The create/update input the server validates (`filmInput` in
/// src/server/films.ts). Optional fields left nil are sent as null, which
/// the server stores as empty.
nonisolated struct FilmInput: Encodable, Sendable {
  var title: String
  var director: String?
  var year: Int?
  var format: String
  var audio: String?
  var hdr: String?
  var region: String?
  var label: String?
  var edition: String?
  var packageType: String?
  var spineNumber: Int?
  var runtimeMinutes: Int?
  var discCount: Int
  var barcode: String?
  var coverUrl: String?
  var notes: String?
  var pricePaid: Double?
  /// Manual TMDB reference — wins over the title search when set.
  var tmdbId: Int?
  /// "movie" | "tv" — disambiguates `tmdbId`, whose namespaces collide.
  var tmdbMediaType: String?

  init(
    title: String, director: String? = nil, year: Int? = nil,
    format: String = "Blu-ray", audio: String? = nil, hdr: String? = nil,
    region: String? = nil, label: String? = nil, edition: String? = nil,
    packageType: String? = nil, spineNumber: Int? = nil,
    runtimeMinutes: Int? = nil, discCount: Int = 1, barcode: String? = nil,
    coverUrl: String? = nil, notes: String? = nil, pricePaid: Double? = nil,
    tmdbId: Int? = nil, tmdbMediaType: String? = nil
  ) {
    self.title = title
    self.director = director
    self.year = year
    self.format = format
    self.audio = audio
    self.hdr = hdr
    self.region = region
    self.label = label
    self.edition = edition
    self.packageType = packageType
    self.spineNumber = spineNumber
    self.runtimeMinutes = runtimeMinutes
    self.discCount = discCount
    self.barcode = barcode
    self.coverUrl = coverUrl
    self.notes = notes
    self.pricePaid = pricePaid
    self.tmdbId = tmdbId
    self.tmdbMediaType = tmdbMediaType
  }

  // Explicit nulls: the server's `nullish()` fields accept them, and an
  // update must be able to clear a field.
  func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(title, forKey: .title)
    try c.encode(director, forKey: .director)
    try c.encode(year, forKey: .year)
    try c.encode(format, forKey: .format)
    try c.encode(audio, forKey: .audio)
    try c.encode(hdr, forKey: .hdr)
    try c.encode(region, forKey: .region)
    try c.encode(label, forKey: .label)
    try c.encode(edition, forKey: .edition)
    try c.encode(packageType, forKey: .packageType)
    try c.encode(spineNumber, forKey: .spineNumber)
    try c.encode(runtimeMinutes, forKey: .runtimeMinutes)
    try c.encode(discCount, forKey: .discCount)
    try c.encode(barcode, forKey: .barcode)
    try c.encode(coverUrl, forKey: .coverUrl)
    try c.encode(notes, forKey: .notes)
    try c.encode(pricePaid, forKey: .pricePaid)
    try c.encode(tmdbId, forKey: .tmdbId)
    try c.encode(tmdbMediaType, forKey: .tmdbMediaType)
  }

  private enum CodingKeys: String, CodingKey {
    case title, director, year, format, audio, hdr, region, label, edition,
      packageType, spineNumber, runtimeMinutes, discCount, barcode, coverUrl,
      notes, pricePaid, tmdbId, tmdbMediaType
  }
}
