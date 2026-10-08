import Foundation

/// The film form's editable state — every field a string, exactly as typed —
/// the web's `FilmFormValues` (src/components/film-form.tsx). Conversion to
/// and from the server shapes lives here so the add and edit sheets agree.
nonisolated struct FilmFormValues: Equatable, Sendable {
  var title = ""
  var director = ""
  var year = ""
  var format = "Blu-ray"
  var audio = ""
  var hdr = ""
  var region = ""
  var label = ""
  var edition = ""
  var packageType = ""
  var spineNumber = ""
  var runtimeMinutes = ""
  var discCount = "1"
  var barcode = ""
  var coverUrl = ""
  var notes = ""
  var pricePaid = ""
  var tmdbId = ""

  /// `emptyFilmValues`: a blank form — Blu-ray, one disc.
  static let empty = FilmFormValues()

  init() {}

  /// `filmToValues`: a stored film as editable strings.
  init(film: Film) {
    title = film.title
    director = film.director ?? ""
    year = film.year.map(String.init) ?? ""
    format = film.format
    audio = film.audio ?? ""
    hdr = film.hdr ?? ""
    region = film.region ?? ""
    label = film.label ?? ""
    edition = film.edition ?? ""
    packageType = film.packageType ?? ""
    spineNumber = film.spineNumber.map(String.init) ?? ""
    runtimeMinutes = film.runtimeMinutes.map(String.init) ?? ""
    discCount = String(film.discCount)
    barcode = film.barcode ?? ""
    coverUrl = film.coverUrl ?? ""
    notes = film.notes ?? ""
    pricePaid = film.pricePaid ?? ""
    tmdbId = film.tmdbId.map { "\(film.tmdbMediaType ?? "movie")/\($0)" } ?? ""
  }

  /// The form's submit check: "A title is required".
  var hasTitle: Bool {
    !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
  }

  /// `valuesToInput`: the server's create/update shape. Blank optional
  /// fields become null, "SDR" means no HDR, numbers parse like JavaScript's
  /// `parseInt`/`parseFloat` ("123 minutes" → 123, "£1,234.50" → 1234.5).
  var input: FilmInput {
    let tmdb = Self.parseTmdbRef(tmdbId)
    return FilmInput(
      title: title,
      director: director.nilIfEmpty,
      year: Self.parseInt(year),
      format: format,
      audio: audio.nilIfEmpty,
      hdr: hdr == "SDR" ? nil : hdr.nilIfEmpty,
      region: region.nilIfEmpty,
      label: label.nilIfEmpty,
      edition: edition.nilIfEmpty,
      packageType: packageType.nilIfEmpty,
      spineNumber: Self.parseInt(spineNumber),
      runtimeMinutes: Self.parseInt(runtimeMinutes),
      discCount: Self.parseInt(discCount) ?? 1,
      barcode: barcode.nilIfEmpty,
      coverUrl: coverUrl.nilIfEmpty,
      notes: notes.nilIfEmpty,
      pricePaid: Self.parsePrice(pricePaid),
      tmdbId: tmdb.id,
      tmdbMediaType: tmdb.mediaType)
  }

  // MARK: Parsing (the web's toInt / toPrice / parseTmdbRef)

  /// JavaScript's `parseInt(s, 10)`: optional leading whitespace and sign,
  /// then as many digits as there are — "123 minutes" → 123, "abc" → nil.
  static func parseInt(_ text: String) -> Int? {
    var rest = Substring(text).drop(while: \.isWhitespace)
    var negative = false
    if let sign = rest.first, sign == "-" || sign == "+" {
      negative = sign == "-"
      rest = rest.dropFirst()
    }
    let digits = rest.prefix(while: { ("0"..."9").contains($0) })
    guard !digits.isEmpty, let value = Int(digits) else { return nil }
    return negative ? -value : value
  }

  /// The web's `toPrice`: strip currency symbols, thousands commas, and
  /// spaces, then `parseFloat`; negative or unparseable prices are nil.
  static func parsePrice(_ text: String) -> Double? {
    let cleaned = text.filter { !"£$€,".contains($0) && !$0.isWhitespace }
    guard
      let match = cleaned.prefixMatch(
        of: /[+-]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?/),
      let value = Double(match.output)
    else { return nil }
    return value.isFinite && value >= 0 ? value : nil
  }

  /// A manual TMDB reference. Movie and TV ids collide on TMDB, so the
  /// field accepts "tv/60573", "movie/603", a full themoviedb.org URL, or a
  /// bare id (no media type — the server tries a movie first).
  static func parseTmdbRef(_ text: String) -> (id: Int?, mediaType: String?) {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    let typed = /(?:themoviedb\.org\/)?\b(movie|tv)\/([0-9]+)/.wordBoundaryKind(.simple)
    if let match = trimmed.firstMatch(of: typed) {
      return (Int(match.output.2), String(match.output.1))
    }
    let id = parseInt(trimmed)
    return (id.flatMap { $0 > 0 ? $0 : nil }, nil)
  }
}

private extension String {
  nonisolated var nilIfEmpty: String? { isEmpty ? nil : self }
}
