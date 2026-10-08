import Foundation

/// Vocabularies shared with the web (src/lib/film-helpers.ts).
nonisolated enum FilmVocabulary {
  /// Disc formats, best first — also the "format" sort order.
  static let formats = ["4K UHD", "Blu-ray", "DVD"]
  static let packageTypes = [
    "Standard", "Steelbook", "Digipack", "Boxset", "Slipcover", "Mediabook",
  ]
  static let hdrTypes = ["HDR10", "HDR10+", "Dolby Vision", "SDR"]
  static let regions = ["A", "B", "C", "Free", "1", "2", "3", "4"]
}

nonisolated extension Film {
  /// Effective watched state: the manual override wins, else the
  /// Letterboxd sync.
  var isWatched: Bool { watchedOverride ?? letterboxdWatched }

  /// TMDB matched it as a series. Unmatched titles count as movies.
  var isTV: Bool { tmdbMediaType == "tv" }

  /// The director field split into names ("A, B" / "A & B" / "A and B").
  var directors: [String] { Film.splitDirectors(director) }

  /// "2160p" / "1080p" / "480p/576p".
  var resolution: String {
    switch format {
    case "4K UHD": "2160p"
    case "Blu-ray": "1080p"
    case "DVD": "480p/576p"
    default: "Unknown"
    }
  }

  /// The A–Z bucket: first letter of the sort title, "#" for anything else.
  var sortLetter: String {
    guard let first = sortTitle.first?.uppercased(), first.count == 1,
      let scalar = first.unicodeScalars.first, ("A"..."Z").contains(scalar)
    else { return "#" }
    return first
  }

  /// "1990s", or nil without a year.
  var decade: String? {
    year.map { "\(($0 / 10) * 10)s" }
  }

  /// `pricePaid` as a number.
  var priceValue: Double? { pricePaid.flatMap(Double.init) }

  /// Revenue ÷ budget, when TMDB knows both.
  var returnOnBudget: Double? {
    guard let budget = tmdbDetails?.budget, budget > 0,
      let revenue = tmdbDetails?.revenue, revenue > 0
    else { return nil }
    return revenue / budget
  }

  var coverURL: URL? { coverUrl.flatMap(URL.init(string:)) }

  var tmdbURL: URL? {
    tmdbId.flatMap { URL(string: "https://www.themoviedb.org/\(isTV ? "tv" : "movie")/\($0)") }
  }

  var imdbURL: URL? {
    tmdbDetails?.imdbId.flatMap { URL(string: "https://www.imdb.com/title/\($0)/") }
  }

  static func splitDirectors(_ field: String?) -> [String] {
    guard let field else { return [] }
    return field
      .replacingOccurrences(of: " and ", with: ",")
      .split(whereSeparator: { $0 == "," || $0 == "&" })
      .map { $0.trimmingCharacters(in: .whitespaces) }
      .filter { !$0.isEmpty }
  }

  /// Strip leading articles for alphabetical sorting, à la library
  /// catalogues — the server's `toSortTitle`.
  static func sortTitle(for title: String) -> String {
    let lowered = title.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    for article in ["the ", "a ", "an "] where lowered.hasPrefix(article) {
      return String(lowered.dropFirst(article.count)).trimmingCharacters(in: .whitespaces)
    }
    return lowered
  }
}
