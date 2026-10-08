import Foundation

/// One typed wrapper per server function exposed at /api/v1 — the names
/// match src/routes/api/v1/$.ts, and the shapes the handlers in src/server.
/// In-band failures (`{ ok: false, error }`) come back as `Outcome.failure`
/// so callers can show the server's message.
nonisolated extension APIClient {
  // MARK: Session

  private struct SessionPayload: Decodable { var user: SessionUser }

  /// The signed-in user, or nil when the token no longer names a session.
  func session() async throws -> SessionUser? {
    let payload: SessionPayload? = try await call("session")
    return payload?.user
  }

  // MARK: Films

  func listFilms() async throws -> [Film] {
    try await call("listFilms")
  }

  func getFilm(id: String) async throws -> Film? {
    try await call("getFilm", ["id": id])
  }

  /// Adds the film; the server enriches it from TMDB, Rotten Tomatoes, and
  /// criterion.com before answering.
  func createFilm(_ input: FilmInput) async throws -> Film {
    try await call("createFilm", input, timeout: 120)
  }

  func updateFilm(id: String, _ input: FilmInput) async throws -> FilmUpdate {
    try await call("updateFilm", Identified(id: id, input: input), timeout: 120)
  }

  func deleteFilm(id: String) async throws {
    let _: Acknowledged = try await call("deleteFilm", ["id": id])
  }

  /// true/false pins the watched state; nil follows the Letterboxd sync.
  func setWatchedOverride(id: String, watched: Bool?) async throws -> Film? {
    struct Input: Encodable {
      var id: String
      var watched: Bool?
      func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(watched, forKey: .watched)
      }
      enum CodingKeys: String, CodingKey { case id, watched }
    }
    return try await call("setWatchedOverride", Input(id: id, watched: watched))
  }

  // MARK: Wishlist

  func listWishlist() async throws -> [WishlistItem] {
    try await call("listWishlist")
  }

  func createWishlistItem(_ input: WishlistInput) async throws -> WishlistItem {
    try await call("createWishlistItem", input)
  }

  func deleteWishlistItem(id: String) async throws {
    let _: Acknowledged = try await call("deleteWishlistItem", ["id": id])
  }

  /// Bought it — the item becomes a film; nil if the item was already gone.
  func moveToCollection(id: String) async throws -> Film? {
    try await call("moveToCollection", ["id": id])
  }

  /// Scrape a supported retailer's product page (HMV, Zavvi, Arrow, …).
  func scrapeWishlistUrl(_ url: String) async throws -> ScrapeResult {
    try await call("scrapeWishlistUrl", ["url": url], timeout: 90)
  }

  // MARK: Settings

  func getSettings() async throws -> UserSettings? {
    try await call("getSettings")
  }

  func saveSettings(letterboxdUsername: String?) async throws -> UserSettings {
    struct Input: Encodable {
      var letterboxdUsername: String?
      func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(letterboxdUsername, forKey: .letterboxdUsername)
      }
      enum CodingKeys: String, CodingKey { case letterboxdUsername }
    }
    return try await call("saveSettings", Input(letterboxdUsername: letterboxdUsername))
  }

  /// Replaces the saved views wholesale.
  func saveViews(_ views: [SavedView]) async throws -> UserSettings {
    try await call("saveViews", ["views": views])
  }

  /// Replaces the shelves wholesale, in order.
  func saveShelves(_ shelves: [Shelf]) async throws -> UserSettings {
    try await call("saveShelves", ["shelves": shelves])
  }

  // MARK: Import sources

  /// Blu-ray.com quicksearch — titles or UPC/EAN barcodes.
  func searchBluray(_ query: String) async throws -> [BlurayResult] {
    try await call("searchBluray", ["query": query], timeout: 30)
  }

  func importBlurayUrl(_ url: String) async throws -> Outcome<BlurayImport> {
    try await call("importBlurayUrl", ["url": url], timeout: 30)
  }

  /// CEX's box API — good for older DVDs Blu-ray.com doesn't list. Takes a
  /// barcode or a CEX box id.
  func importCex(barcode: String) async throws -> Outcome<CexImport> {
    try await call("importCex", ["barcode": barcode], timeout: 30)
  }

  /// Last-resort barcode lookup via web search, canonicalised on TMDB.
  func searchWebBarcode(_ barcode: String) async throws -> Outcome<WebBarcodeSearch> {
    try await call("searchWebBarcode", ["barcode": barcode], timeout: 90)
  }

  func lookupSpine(title: String, year: Int?) async throws -> Outcome<SpineLookup> {
    struct Input: Encodable {
      var title: String
      var year: Int?
      func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(title, forKey: .title)
        try c.encode(year, forKey: .year)
      }
      enum CodingKeys: String, CodingKey { case title, year }
    }
    return try await call("lookupSpine", Input(title: title, year: year), timeout: 120)
  }

  // MARK: Per-film enrichment

  func rematchTmdb(id: String) async throws -> Outcome<TmdbRematch> {
    try await call("rematchTmdb", ["id": id], timeout: 60)
  }

  func refreshRtScores(id: String) async throws -> Outcome<RtScores> {
    try await call("refreshRtScores", ["id": id], timeout: 120)
  }

  /// IMDb / TMDB ids for a person. Cast members carry their TMDB id;
  /// directors are resolved by name.
  func personLinks(name: String, tmdbPersonId: Int?) async throws -> PersonLinks {
    struct Input: Encodable {
      var name: String
      var tmdbPersonId: Int?
      func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(name, forKey: .name)
        try c.encode(tmdbPersonId, forKey: .tmdbPersonId)
      }
      enum CodingKeys: String, CodingKey { case name, tmdbPersonId }
    }
    return try await call("getPersonImdb", Input(name: name, tmdbPersonId: tmdbPersonId))
  }

  // MARK: Whole-collection syncs and backfills

  /// Recent Letterboxd diary via RSS — first-time watches only.
  func syncLetterboxd() async throws -> Outcome<LetterboxdSync> {
    try await call("syncLetterboxd", timeout: 180)
  }

  /// Walks the whole Letterboxd diary, pulling ratings and reviews.
  func syncLetterboxdHistory() async throws -> Outcome<LetterboxdHistorySync> {
    try await call("syncLetterboxdHistory", timeout: Self.backfillTimeout)
  }

  func syncTmdbCast() async throws -> Outcome<BackfillResult> {
    try await call("syncTmdbCast", timeout: Self.backfillTimeout)
  }

  func syncTmdbDetails() async throws -> Outcome<BackfillResult> {
    try await call("syncTmdbDetails", timeout: Self.backfillTimeout)
  }

  func syncRottenTomatoes() async throws -> Outcome<BackfillResult> {
    try await call("syncRottenTomatoes", timeout: Self.backfillTimeout)
  }

  func syncCriterionSpines() async throws -> Outcome<CriterionSync> {
    try await call("syncCriterionSpines", timeout: Self.backfillTimeout)
  }
}

/// `{ id, ...input }` — the update shape for films.
private nonisolated struct Identified<Input: Encodable>: Encodable {
  var id: String
  var input: Input

  func encode(to encoder: Encoder) throws {
    try input.encode(to: encoder)
    var c = encoder.container(keyedBy: Key.self)
    try c.encode(id, forKey: .id)
  }

  private enum Key: String, CodingKey { case id }
}
