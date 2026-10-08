import Foundation

/// A `user_settings` row. Absent until the user first saves something, so
/// the server can answer `getSettings` with null.
nonisolated struct UserSettings: Codable, Hashable, Sendable {
  var userId: String
  var letterboxdUsername: String?
  var lastLetterboxdSyncAt: Date?
  var savedViews: [SavedView]?
  var shelves: [Shelf]?
}

/// A saved collection-page view: a name plus the browse state it restores.
/// `params` uses the web's URL search-param keys (q, sort, dir, letter,
/// decade, format, hdr, region, label, packageType, edition, watched, tmdb,
/// view, overlay, type), so a view saved on the web restores in the app and
/// the other way round.
nonisolated struct SavedView: Codable, Hashable, Sendable {
  var name: String
  var params: [String: String]
  var isDefault: Bool?
}

/// A film field a shelf rule can test.
nonisolated enum ShelfRuleField: String, Codable, CaseIterable, Sendable {
  case format, mediaType, label, edition, packageType, hdr, region, decade,
    watched, genre
}

/// One shelf rule: the film's field value must be one of `values` (OR).
nonisolated struct ShelfRule: Codable, Hashable, Sendable {
  var field: ShelfRuleField
  var values: [String]
}

nonisolated enum ShelfSortKey: String, Codable, CaseIterable, Sendable {
  case title, spine, year, added, publisher, runtime
}

nonisolated enum SortDirection: String, Codable, Sendable {
  case asc, desc
}

/// One level of a shelf's sort — earlier levels win, later ones tie-break.
nonisolated struct ShelfSortLevel: Codable, Hashable, Sendable {
  var key: ShelfSortKey
  var dir: SortDirection?
}

nonisolated enum ShelfGroupBy: String, Codable, CaseIterable, Sendable {
  case label, format, decade
}

/// A physical shelf, digitally mirrored (see the `Shelf` docs in
/// src/db/schema.ts). Shelves partition the collection: a film sits on the
/// first shelf, top to bottom, whose rules all match.
///
/// Optional fields are omitted from JSON when nil — the server's schema
/// accepts a missing key but rejects null.
nonisolated struct Shelf: Codable, Hashable, Identifiable, Sendable {
  var id: String
  var name: String
  var rules: [ShelfRule]
  var sort: [ShelfSortLevel]?
  var groupBy: ShelfGroupBy?
  /// Physical slot count — overflow is flagged, not hidden.
  var capacity: Int?
  /// Film ids forced onto this shelf regardless of rules.
  var pinned: [String]?
  /// Film ids forced off this shelf even when the rules match.
  var excluded: [String]?
  /// Hand-arranged order — ids listed first, the rest sorted.
  var manualOrder: [String]?
  /// ISO-8601 instant the physical shelf was last arranged.
  var arrangedAt: String?
}
