import Foundation

/// Each import source's payload mapped onto the film form — the web's
/// src/lib/import-mappers.ts, plus `importFromUrl` and `looksLikeUrl` from
/// src/components/bluray-import.tsx and `cleanBlurayTitle` from the form.
nonisolated enum FilmImport {
  /// The free-text HDR line from Blu-ray.com, mapped onto the form's options.
  static func normalizeHdr(_ hdr: String?) -> String {
    guard let hdr, !hdr.isEmpty else { return "" }
    if hdr.contains("Dolby Vision") { return "Dolby Vision" }
    if hdr.contains("HDR10+") { return "HDR10+" }
    if hdr.contains("HDR10") { return "HDR10" }
    return ""
  }

  /// `blurayToValues`: a Blu-ray.com product page → form values.
  static func values(from data: BlurayImport) -> FilmFormValues {
    var values = FilmFormValues.empty
    values.title = data.title
    values.director = data.director ?? ""
    values.year = data.year.map(String.init) ?? ""
    values.format = data.format
    values.audio = data.audio ?? ""
    values.hdr = normalizeHdr(data.hdr)
    // "A, B" → "A": the form holds one region.
    values.region =
      data.region?.split(separator: ",", omittingEmptySubsequences: false).first
      .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) } ?? ""
    values.label = data.label ?? ""
    values.spineNumber = data.spineNumber.map(String.init) ?? ""
    values.runtimeMinutes = data.runtimeMinutes.map(String.init) ?? ""
    values.discCount = String(data.discCount)
    values.coverUrl = data.coverUrl ?? ""
    return values
  }

  /// `cexToValues`: CEX disc details → form values; the catalogue extras
  /// land in the notes.
  static func values(from data: CexImport) -> FilmFormValues {
    var notes: [String] = []
    if let rating = data.bbfcRating, !rating.isEmpty { notes.append("BBFC: \(rating)") }
    if !data.genres.isEmpty { notes.append("Genre: \(data.genres.joined(separator: ", "))") }
    if let publisher = data.publisher, !publisher.isEmpty { notes.append("Publisher: \(publisher)") }
    if let supplier = data.supplier, !supplier.isEmpty { notes.append("Supplier: \(supplier)") }

    var values = FilmFormValues.empty
    values.title = data.title
    values.year = data.year.map(String.init) ?? ""
    values.format = data.format
    values.label = data.label ?? ""
    values.runtimeMinutes = data.runtimeMinutes.map(String.init) ?? ""
    values.coverUrl = data.coverUrl ?? ""
    values.barcode = data.barcode
    values.notes = notes.joined(separator: "\n")
    return values
  }

  /// `scrapeToValues`: a retailer product page (via the wishlist scraper) →
  /// form values. The format and year are read out of the shop's title,
  /// then stripped from it.
  static func values(from data: ScrapedProduct) -> FilmFormValues {
    let raw = data.title
    let year = raw.firstMatch(of: /\((19|20)[0-9]{2}\)/)
      .map { String($0.output.0.dropFirst().prefix(4)) } ?? ""
    let format =
      raw.contains(/4k|uhd|ultra hd/.ignoresCase())
      ? "4K UHD"
      : raw.contains(/\bdvd\b/.ignoresCase().wordBoundaryKind(.simple)) ? "DVD" : "Blu-ray"

    var title = raw.replacing(
      /\s*[(\[][^)\]]*(4K|UHD|Blu-?ray|DVD|Ultra HD)[^)\]]*[)\]]/.ignoresCase(), with: " ")
    title = title.replacing(/\s*[-–]\s*(4K Ultra HD|Blu-?ray|DVD).*$/.ignoresCase(), with: " ")
    title = title.replacing(/\s*\((19|20)[0-9]{2}\)\s*/, with: " ", maxReplacements: 1)
    title = title.replacing(/\s+/, with: " ").trimmingCharacters(in: .whitespacesAndNewlines)

    var values = FilmFormValues.empty
    values.title = title.isEmpty ? raw : title
    values.year = year
    values.format = format
    values.coverUrl = data.imageUrl ?? ""
    values.notes = [data.retailer, data.price ?? ""].filter { !$0.isEmpty }.joined(separator: " · ")
    return values
  }

  /// Imports don't know the barcode that was just scanned — keep it. Every
  /// import path applies this same step, so a disc found on any source lands
  /// in the form with the scanned barcode filled.
  static func withScannedBarcode(_ values: FilmFormValues, _ scanned: String?) -> FilmFormValues {
    var values = values
    if values.barcode.isEmpty { values.barcode = scanned ?? "" }
    return values
  }

  /// The CEX box id from a uk.webuy.com product link.
  static func cexID(from url: URL) -> String? {
    guard let host = url.host()?.lowercased(), host == "webuy.com" || host.hasSuffix(".webuy.com")
    else { return nil }
    let id = URLComponents(url: url, resolvingAgainstBaseURL: false)?
      .queryItems?.first { $0.name == "id" }?.value
    return id?.isEmpty == false ? id : nil
  }

  /// A pasted link rather than a title to search for.
  static func looksLikeURL(_ value: String) -> Bool {
    value.trimmingCharacters(in: .whitespacesAndNewlines)
      .prefixMatch(of: /https?:\/\//.ignoresCase()) != nil
      || value.contains("blu-ray.com/")
  }

  /// Strip the parenthetical junk Blu-ray.com appends — alternate titles,
  /// the year, "4K Ultra HD".
  static func cleanBlurayTitle(_ title: String) -> String {
    title.replacing(/\s*\([^)]*\)\s*/, with: " ")
      .trimmingCharacters(in: .whitespacesAndNewlines)
  }

  /// `importFromUrl`: import a product link from whichever source it
  /// belongs to. Blu-ray.com pages get the full disc parser, CEX links use
  /// their box API, and any other supported retailer goes through the
  /// wishlist scraper (title, price, cover — TMDB fills the rest on add).
  ///
  /// A source's own "couldn't do it" message is thrown as
  /// `APIError.rejected`, for the caller to show as it is.
  static func importFromURL(
    _ raw: String, using api: APIClient
  ) async throws -> (values: FilmFormValues, source: String) {
    guard let url = URL(string: raw), url.scheme != nil, let rawHost = url.host(), !rawHost.isEmpty
    else { throw APIError.rejected("That's not a valid URL.") }
    var host = rawHost.lowercased()
    if host.hasPrefix("www.") { host.removeFirst(4) }

    if host.hasSuffix("blu-ray.com") {
      let data = try await api.importBlurayUrl(raw).get()
      return (values(from: data), "Blu-ray.com")
    }

    if let cexID = cexID(from: url) {
      let data = try await api.importCex(barcode: cexID).get()
      return (values(from: data), "CEX")
    }

    switch try await api.scrapeWishlistUrl(raw) {
    case .success(let product):
      return (values(from: product), product.retailer)
    case .failure(let error, _):
      throw APIError.rejected(error)
    }
  }
}

extension Toasts {
  /// Report a failed Film-screen action the way the web does: the server's
  /// own message when it declined the request, otherwise the web's fallback
  /// line for that action. Cancellations and expired sessions stay silent.
  func filmFailure(_ error: Error, fallback: String, showServerMessage: Bool = true) {
    if error is CancellationError || Task.isCancelled { return }
    switch error as? APIError {
    case .unauthorized?:
      return
    case .rejected(let message)? where showServerMessage:
      self.error(message)
    default:
      self.error(fallback)
    }
  }
}
