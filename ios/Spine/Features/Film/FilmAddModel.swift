import Foundation
import Observation

/// The add-a-film flow's state: the form values, the one import field
/// (a debounced Blu-ray.com autocomplete, or a pasted product link), and the
/// scanned-barcode lookup chain — the web's `BlurayImportBox` and add page.
@Observable
final class FilmAddModel {
  /// The form below the import field. Every import replaces it wholesale.
  var values = FilmFormValues.empty
  /// The import field: a title, a barcode, or a pasted link.
  var query = ""

  private(set) var results: [BlurayResult] = []
  private(set) var webMatches: [TmdbTitleMatch] = []
  /// The match list is showing (the web's dropdown `open`).
  private(set) var listOpen = false
  private(set) var searching = false
  /// The product link being imported, while it imports.
  private(set) var importingURL: String?
  /// The last barcode scanned — carried into every import that follows.
  private(set) var scannedCode: String?
  /// Where the scan chain has got to, e.g. "Not on Blu-ray.com — trying CEX…".
  private(set) var scanStage: String?
  /// Bumped on every detection, for the success haptic.
  private(set) var scanCount = 0
  /// Bumped whenever an import fills the form, so the view can bring it
  /// into sight.
  private(set) var importCount = 0

  private var scanTask: Task<Void, Never>?

  var isURL: Bool { FilmImport.looksLikeURL(query) }
  var importing: Bool { importingURL != nil }
  var scanPending: Bool { scanTask != nil }
  var isBusy: Bool { searching || importing || scanPending }

  /// Web-search matches first, then Blu-ray.com hits; none for a link.
  var showsWebMatches: Bool { listOpen && !isURL && !webMatches.isEmpty }
  var showsResults: Bool { listOpen && !isURL && !results.isEmpty }

  // MARK: Autocomplete

  /// Run from `.task(id: query)`, so a newer keystroke cancels this one:
  /// a 400 ms debounce, then a Blu-ray.com search.
  func autocomplete(api: APIClient) async {
    let query = query.trimmingCharacters(in: .whitespacesAndNewlines)
    if isURL || query.count < 2 {
      results = []
      searching = false
      return
    }
    // A just-scanned barcode runs its own lookup chain — don't double-search.
    if query == scannedCode {
      searching = false
      return
    }
    searching = true
    do {
      try await Task.sleep(for: .milliseconds(400))
      let found = try await api.searchBluray(query)
      guard !Task.isCancelled else { return }
      results = found
      listOpen = true
    } catch {
      // Superseded by a newer keystroke (which owns `searching` now), or a
      // search hiccup — keep the previous results.
      guard !Task.isCancelled else { return }
    }
    searching = false
  }

  // MARK: Picking a match

  /// A web-search TMDB match fills the basics; TMDB does the rest on add.
  func pick(_ match: TmdbTitleMatch) {
    listOpen = false
    webMatches = []
    var values = FilmFormValues.empty
    values.title = match.title
    values.year = match.year.map(String.init) ?? ""
    values.coverUrl = match.posterUrl ?? ""
    values.barcode = scannedCode ?? ""
    values.tmdbId = "\(match.mediaType)/\(match.tmdbId)"
    fill(values)
  }

  /// A Blu-ray.com hit runs the full product-page import.
  func pick(_ result: BlurayResult, api: APIClient, toasts: Toasts) {
    importLink(result.url, api: api, toasts: toasts)
  }

  /// The pasted link in the import field.
  func importTypedLink(api: APIClient, toasts: Toasts) {
    let link = query.trimmingCharacters(in: .whitespacesAndNewlines)
    guard isURL, !link.isEmpty else { return }
    importLink(link, api: api, toasts: toasts)
  }

  private func importLink(_ link: String, api: APIClient, toasts: Toasts) {
    guard !importing else { return }
    importingURL = link
    Task {
      defer { importingURL = nil }
      do {
        let imported = try await FilmImport.importFromURL(link, using: api)
        listOpen = false
        query = ""
        results = []
        webMatches = []
        fill(FilmImport.withScannedBarcode(imported.values, scannedCode))
        toasts.success("Imported “\(imported.values.title)” from \(imported.source)")
      } catch {
        toasts.filmFailure(error, fallback: "Import failed")
      }
    }
  }

  // MARK: Scanned barcodes

  /// The scanned-barcode chain: Blu-ray.com → CEX → web search → by hand.
  /// A re-scan cancels the chain in flight, so a slow lookup for a misread
  /// barcode can never land after — and override — the newer scan.
  func scanned(_ code: String, api: APIClient, toasts: Toasts) {
    scanTask?.cancel()
    scanCount += 1
    scannedCode = code
    query = code
    results = []
    webMatches = []
    scanTask = Task {
      await runScanChain(code, api: api, toasts: toasts)
      if !Task.isCancelled { scanTask = nil }
    }
  }

  private func runScanChain(_ code: String, api: APIClient, toasts: Toasts) async {
    do {
      scanStage = "Searching Blu-ray.com…"
      let found = try await api.searchBluray(code)
      try Task.checkCancellation()
      if !found.isEmpty {
        scanStage = nil
        results = found
        webMatches = []
        listOpen = true
        return
      }

      scanStage = "Not on Blu-ray.com — trying CEX…"
      if case .success(let cex) = try await api.importCex(barcode: code) {
        try Task.checkCancellation()
        scanStage = nil
        fill(FilmImport.withScannedBarcode(FilmImport.values(from: cex), code))
        toasts.success("Imported “\(cex.title)” from CEX")
        return
      }
      try Task.checkCancellation()

      scanStage = "Not on CEX either — searching the web…"
      let web = try await api.searchWebBarcode(code)
      try Task.checkCancellation()
      scanStage = nil
      if case .success(let search) = web, !search.matches.isEmpty {
        webMatches = search.matches
        results = []
        listOpen = true
        return
      }
      var values = FilmFormValues.empty
      values.barcode = code
      fill(values)
      toasts.info("No match for \(code) anywhere — barcode filled in, add the rest by hand.")
    } catch {
      // Cancelled by a re-scan — the newer chain owns the UI now.
      if Task.isCancelled { return }
      scanStage = nil
      toasts.error("Barcode lookup failed")
    }
  }

  private func fill(_ values: FilmFormValues) {
    self.values = values
    importCount += 1
  }
}
