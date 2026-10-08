import Foundation

/// A Blu-ray.com quicksearch hit (`searchBluray`). Also matches barcodes.
nonisolated struct BlurayResult: Decodable, Hashable, Sendable {
  var title: String
  var year: Int?
  var url: String
  /// Full-size `_front.jpg` cover.
  var coverUrl: String
  var countryFlag: String?
  var releaseDate: String?
}

/// Every field `importBlurayUrl` pulls off a Blu-ray.com product page.
nonisolated struct BlurayImport: Decodable, Hashable, Sendable {
  var title: String
  var year: Int?
  var director: String?
  var format: String
  var audio: String?
  var hdr: String?
  var region: String?
  var label: String?
  var spineNumber: Int?
  var runtimeMinutes: Int?
  var discCount: Int
  var coverUrl: String?
  var url: String
}

/// Disc details from CEX's box API (`importCex`).
nonisolated struct CexImport: Decodable, Hashable, Sendable {
  var title: String
  var year: Int?
  var format: String
  var runtimeMinutes: Int?
  var label: String?
  var bbfcRating: String?
  var genres: [String]
  var publisher: String?
  var supplier: String?
  var coverUrl: String?
  var barcode: String
}

/// A canonical TMDB title, used to pick among fuzzy web-search results.
nonisolated struct TmdbTitleMatch: Decodable, Hashable, Sendable {
  var tmdbId: Int
  /// "movie" | "tv"
  var mediaType: String
  var title: String
  var year: Int?
  var posterUrl: String?
}

/// `searchWebBarcode` success: the titles shops agreed on, canonicalised.
nonisolated struct WebBarcodeSearch: Decodable, Hashable, Sendable {
  var candidates: [String]
  var matches: [TmdbTitleMatch]
}

/// `lookupSpine` success — nil when criterion.com has no such title.
nonisolated struct SpineLookup: Decodable, Hashable, Sendable {
  var spine: Int?
}

/// `syncLetterboxd` success.
nonisolated struct LetterboxdSync: Decodable, Hashable, Sendable {
  var scanned: Int
  var matched: Int
}

/// `syncLetterboxdHistory` success.
nonisolated struct LetterboxdHistorySync: Decodable, Hashable, Sendable {
  var pages: Int
  var filmsSeen: Int
  var matched: Int
  var reviews: Int
}

/// Result of the per-film backfills: TMDB cast, TMDB details, Rotten
/// Tomatoes.
nonisolated struct BackfillResult: Decodable, Hashable, Sendable {
  var scanned: Int
  var updated: Int
  var unmatched: Int
}

/// `syncCriterionSpines` success.
nonisolated struct CriterionSync: Decodable, Hashable, Sendable {
  var listSize: Int
  var refreshed: Bool
  var scanned: Int
  var updated: Int
}

/// `rematchTmdb` success.
nonisolated struct TmdbRematch: Decodable, Hashable, Sendable {
  var castCount: Int
}

/// `refreshRtScores` success.
nonisolated struct RtScores: Decodable, Hashable, Sendable {
  var url: String
  var criticsScore: Int?
  var audienceScore: Int?
}

/// `getPersonImdb` result.
nonisolated struct PersonLinks: Decodable, Hashable, Sendable {
  var imdbId: String?
  var tmdbPersonId: Int?
}
