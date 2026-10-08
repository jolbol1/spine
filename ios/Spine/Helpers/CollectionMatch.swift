import Foundation

/// Deciding whether a disc is already in the collection — for the duplicate
/// warning on add and scan, and for checking a shelf photo against the
/// catalogue. A port of src/lib/collection-match.ts; keep the two in step.
nonisolated enum CollectionMatch {
  /// Why a film looks like the disc about to be added, most certain first.
  enum Reason: Int, CaseIterable, Hashable, Sendable {
    /// Same barcode: this exact disc is already catalogued.
    case barcode
    /// Same title (and year, when both are known) in the same format.
    case sameFormat
    /// Same title, but the collection has it in another format.
    case otherFormat
  }

  struct Match: Hashable, Sendable {
    let film: Film
    let reason: Reason
  }

  /// The disc about to be added, as far as it's known.
  struct Candidate: Hashable, Sendable {
    var title: String
    var year: Int?
    var format: String?
    var barcode: String?

    init(title: String, year: Int? = nil, format: String? = nil, barcode: String? = nil) {
      self.title = title
      self.year = year
      self.format = format
      self.barcode = barcode
    }
  }

  /// A loose title key: case, accents, punctuation, "&"/"and", and a leading
  /// article don't count. "The Godfather: Part II" and "godfather part ii"
  /// match.
  static func titleKey(_ title: String) -> String {
    // NFKD, then drop the combining diacritical marks (U+0300–U+036F).
    var scalars = String.UnicodeScalarView()
    scalars.append(
      contentsOf: title.decomposedStringWithCompatibilityMapping.unicodeScalars
        .filter { !(0x300...0x36F).contains($0.value) })
    var text = String(scalars).lowercased()
      .replacingOccurrences(of: "&", with: " and ")
      .trimmingCharacters(in: .whitespacesAndNewlines)
    if let article = text.prefixMatch(of: /(?:the|a|an)\s+/) {
      text = String(text[article.range.upperBound...])
    }
    var key = String.UnicodeScalarView()
    key.append(
      contentsOf: text.unicodeScalars.filter { ("a"..."z").contains($0) || ("0"..."9").contains($0) })
    return String(key)
  }

  /// Barcodes compare on digits alone, and a 12-digit UPC-A equals its
  /// 13-digit EAN-13 form (a leading 0) — the same disc scans either way.
  /// Anything shorter than 8 digits isn't a barcode.
  static func barcodeKey(_ barcode: String?) -> String? {
    let digits = (barcode ?? "").unicodeScalars.filter { ("0"..."9").contains($0) }
    guard digits.count >= 8 else { return nil }
    let text = String(String.UnicodeScalarView(digits))
    return text.count == 13 && text.hasPrefix("0") ? String(text.dropFirst()) : text
  }

  /// Films in the collection that look like `candidate`, most certain
  /// first. `excluding` leaves out the film being edited.
  static func duplicates(
    in films: [Film], of candidate: Candidate, excluding excludedID: String? = nil
  ) -> [Match] {
    let barcode = barcodeKey(candidate.barcode)
    let key = titleKey(candidate.title)
    let format = candidate.format.flatMap { $0.isEmpty ? nil : $0 }
    var matches: [Match] = []
    for film in films where film.id != excludedID {
      if let barcode, barcodeKey(film.barcode) == barcode {
        matches.append(Match(film: film, reason: .barcode))
        continue
      }
      guard !key.isEmpty, titleKey(film.title) == key else { continue }
      // Remakes share titles; a year on both sides tells them apart.
      if let year = candidate.year, let filmYear = film.year, filmYear != year { continue }
      let sameFormat = format == nil || format == film.format
      matches.append(Match(film: film, reason: sameFormat ? .sameFormat : .otherFormat))
    }
    // Stable, like the web's sort: collection order within each reason.
    return Reason.allCases.flatMap { reason in matches.filter { $0.reason == reason } }
  }

  /// True when adding would duplicate a disc rather than add another
  /// edition.
  static func isSameDisc(_ matches: [Match]) -> Bool {
    matches.contains { $0.reason != .otherFormat }
  }
}
