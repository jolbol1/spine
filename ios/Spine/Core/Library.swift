import Foundation
import Observation

/// The signed-in user's collection, wishlist, and settings — the app's
/// equivalent of the web's react-query cache. Screens read from here and
/// mutate through it, so every tab sees a change at once. After a write the
/// affected list is refetched, as the web invalidates its queries, so server
/// ordering and enrichment always win.
///
/// The last good copy is kept on disk, so the app opens instantly (and
/// offline) and refreshes in the background.
@Observable
final class Library {
  let api: APIClient
  let userID: String

  /// Ordered as the server orders them: sort title, then year.
  private(set) var films: [Film] = []
  /// Oldest first, as the server orders them.
  private(set) var wishlist: [WishlistItem] = []
  /// nil until the user first saves a setting.
  private(set) var settings: UserSettings?

  /// True once films have come from the disk cache or the server — before
  /// that, an empty `films` means "loading", not "empty shelf".
  private(set) var hasLoadedFilms = false
  private(set) var hasLoadedWishlist = false
  private(set) var hasLoadedSettings = false
  /// True once settings have come from the server this session — not just
  /// the disk cache, which can predate a change made on the web.
  private(set) var hasFetchedSettings = false
  /// The last refresh failure, for a retry banner; cleared on success.
  private(set) var loadError: String?

  /// Re-fetch the Letterboxd feed when the last sync is older than this
  /// (the web's LETTERBOXD_STALE_MS).
  private static let letterboxdStaleInterval: TimeInterval = 12 * 60 * 60
  private var didAutoSync = false

  init(api: APIClient, userID: String) {
    self.api = api
    self.userID = userID
  }

  func film(id: String) -> Film? {
    films.first { $0.id == id }
  }

  // MARK: Loading

  /// First load for a session: disk cache, then the server.
  func bootstrap() async {
    restoreCache()
    await refreshAll()
  }

  /// Refresh everything, recording (not throwing) a failure.
  func refreshAll() async {
    async let films: Void = refreshFilms()
    async let wishlist: Void = refreshWishlist()
    async let settings: Void = refreshSettings()
    do {
      _ = try await (films, wishlist, settings)
      loadError = nil
    } catch is CancellationError {
    } catch APIError.unauthorized {
    } catch {
      loadError = error.userMessage
    }
  }

  func refreshFilms() async throws {
    films = try await api.listFilms()
    hasLoadedFilms = true
    saveCache()
  }

  func refreshWishlist() async throws {
    wishlist = try await api.listWishlist()
    hasLoadedWishlist = true
    saveCache()
  }

  func refreshSettings() async throws {
    settings = try await api.getSettings()
    hasLoadedSettings = true
    hasFetchedSettings = true
    saveCache()
  }

  /// Re-read one film after a server-side change to it (TMDB rematch, RT
  /// refresh). Removes it if it's gone.
  func reloadFilm(id: String) async throws {
    if let film = try await api.getFilm(id: id) {
      replace(film)
    } else {
      films.removeAll { $0.id == id }
    }
    saveCache()
  }

  // MARK: Films

  func createFilm(_ input: FilmInput) async throws -> Film {
    let film = try await api.createFilm(input)
    replace(film)
    await refreshFilmsQuietly()
    return film
  }

  /// Saves the edit. Throws `APIError.rejected` with the server's message
  /// when a manual TMDB id matches nothing.
  @discardableResult
  func updateFilm(id: String, _ input: FilmInput) async throws -> Film {
    switch try await api.updateFilm(id: id, input) {
    case .updated(let film):
      replace(film)
      await refreshFilmsQuietly()
      return film
    case .failed(let message):
      throw APIError.rejected(message)
    }
  }

  func deleteFilm(id: String) async throws {
    try await api.deleteFilm(id: id)
    films.removeAll { $0.id == id }
    saveCache()
  }

  /// true/false pins the watched state; nil goes back to following the
  /// Letterboxd sync.
  func setWatched(id: String, _ watched: Bool?) async throws {
    if let film = try await api.setWatchedOverride(id: id, watched: watched) {
      replace(film)
      saveCache()
    }
  }

  // MARK: Wishlist

  @discardableResult
  func addToWishlist(_ input: WishlistInput) async throws -> WishlistItem {
    let item = try await api.createWishlistItem(input)
    wishlist.append(item)
    await refreshWishlistQuietly()
    return item
  }

  func removeFromWishlist(id: String) async throws {
    try await api.deleteWishlistItem(id: id)
    wishlist.removeAll { $0.id == id }
    saveCache()
  }

  /// Bought it: the item becomes a film. Returns the new film.
  @discardableResult
  func moveToCollection(id: String) async throws -> Film? {
    let film = try await api.moveToCollection(id: id)
    wishlist.removeAll { $0.id == id }
    if let film { replace(film) }
    await refreshFilmsQuietly()
    await refreshWishlistQuietly()
    return film
  }

  // MARK: Settings

  func saveLetterboxdUsername(_ username: String?) async throws {
    let trimmed = username?.trimmingCharacters(in: .whitespaces)
    settings = try await api.saveSettings(
      letterboxdUsername: trimmed?.isEmpty == false ? trimmed : nil)
    saveCache()
  }

  func saveViews(_ views: [SavedView]) async throws {
    settings = try await api.saveViews(views)
    saveCache()
  }

  func saveShelves(_ shelves: [Shelf]) async throws {
    settings = try await api.saveShelves(shelves)
    saveCache()
  }

  /// After a whole-collection sync or backfill the server has rewritten many
  /// rows (and maybe the last-sync stamp): refetch films and settings.
  func refreshAfterSync() async {
    await refreshFilmsQuietly()
    try? await refreshSettings()
  }

  /// The web's background sync on app load: when a Letterboxd username is
  /// set and the last sync is stale, pull the RSS feed once. Returns how many
  /// titles were newly marked watched; failures stay silent (Settings has
  /// the manual buttons).
  func autoSyncLetterboxdIfStale() async -> Int? {
    guard !didAutoSync, hasLoadedSettings, settings?.letterboxdUsername != nil else {
      return nil
    }
    if let last = settings?.lastLetterboxdSyncAt,
      Date.now.timeIntervalSince(last) < Self.letterboxdStaleInterval
    {
      return nil
    }
    didAutoSync = true
    guard case .success(let result)? = try? await api.syncLetterboxd() else { return nil }
    await refreshAfterSync()
    return result.matched
  }

  // MARK: Private

  private func replace(_ film: Film) {
    if let index = films.firstIndex(where: { $0.id == film.id }) {
      films[index] = film
    } else {
      films.append(film)
    }
    hasLoadedFilms = true
  }

  private func refreshFilmsQuietly() async {
    try? await refreshFilms()
  }

  private func refreshWishlistQuietly() async {
    try? await refreshWishlist()
  }

  // MARK: Disk cache

  private struct Snapshot: Codable {
    var films: [Film]
    var wishlist: [WishlistItem]
    var settings: UserSettings?
  }

  private var cacheURL: URL {
    URL.cachesDirectory.appending(path: "library-\(userID).json")
  }

  private func restoreCache() {
    guard let data = try? Data(contentsOf: cacheURL),
      let snapshot = try? JSONCoding.decoder().decode(Snapshot.self, from: data)
    else { return }
    films = snapshot.films
    wishlist = snapshot.wishlist
    settings = snapshot.settings
    hasLoadedFilms = true
    hasLoadedWishlist = true
    hasLoadedSettings = true
  }

  private func saveCache() {
    let snapshot = Snapshot(films: films, wishlist: wishlist, settings: settings)
    guard let data = try? JSONCoding.encoder().encode(snapshot) else { return }
    try? data.write(to: cacheURL, options: [.atomic, .completeFileProtection])
  }

  /// Signing out removes this account's data from the device.
  func discardCache() {
    try? FileManager.default.removeItem(at: cacheURL)
  }
}
