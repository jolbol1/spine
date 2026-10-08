import Foundation

// The collection page's browse logic, ported from src/routes/_app/index.tsx.
// Everything here is pure: the browse state is the web's URL search params
// (`q`, `sort`, `dir`, `letter`, the filter keys, `view`, `overlay`, `type`),
// so a saved view round-trips between the web and the app unchanged.

/// A collection sort (the web's `SortKey`), in the web's menu order.
nonisolated enum CollectionSort: String, CaseIterable, Sendable {
  case title, spine, year, added, budget, boxoffice, roi, rt, rating, tmdbRating, price,
    runtime, publisher, format

  /// The web's `SORT_LABELS`.
  var label: String {
    switch self {
    case .title: "Alphabetical"
    case .spine: "Criterion spine #"
    case .year: "Release year"
    case .added: "Recently added"
    case .budget: "Budget"
    case .boxoffice: "Box office"
    case .roi: "Return on budget"
    case .rt: "RT critics score"
    case .rating: "My rating"
    case .tmdbRating: "TMDB rating"
    case .price: "Price paid"
    case .runtime: "Runtime"
    case .publisher: "Publisher"
    case .format: "Format"
    }
  }

  /// The order each sort produces before a direction toggle reverses it
  /// (the web's `DEFAULT_DIR`).
  var defaultDirection: SortDirection {
    switch self {
    case .title, .spine, .year, .publisher, .format: .asc
    case .added, .budget, .boxoffice, .roi, .rt, .rating, .tmdbRating, .price, .runtime: .desc
    }
  }

  /// Metric sorts (the web's `METRIC_SORTS`): highest first, and the value is
  /// shown as each card's subtext so the order is readable.
  var isMetric: Bool { metricLabel != nil }

  /// How the "titles without … sort last" caption names the metric.
  var metricLabel: String? {
    switch self {
    case .budget: "budget"
    case .boxoffice: "box office"
    case .roi: "return on budget"
    case .rt: "a Rotten Tomatoes score"
    case .rating: "your Letterboxd rating"
    case .tmdbRating: "a TMDB rating"
    case .price: "a price"
    case .runtime: "a runtime"
    default: nil
    }
  }

  /// The metric's value, or nil when the film lacks it.
  func metricValue(_ film: Film) -> Double? {
    switch self {
    case .budget: film.tmdbDetails?.budget
    case .boxoffice: film.tmdbDetails?.revenue
    case .roi: film.returnOnBudget
    case .rt: film.rtCriticsScore.map(Double.init)
    case .rating: film.letterboxdRating
    case .tmdbRating: film.tmdbDetails?.voteAverage
    case .price: film.priceValue
    case .runtime: film.runtimeMinutes.map(Double.init)
    default: nil
    }
  }

  /// The card subtext for a metric sort — only when the film has the value.
  func metricSubtext(_ film: Film) -> String? {
    guard metricValue(film) != nil else { return nil }
    switch self {
    case .budget: return film.tmdbDetails?.budget.map(Formatters.usdCompact)
    case .boxoffice: return film.tmdbDetails?.revenue.map(Formatters.usdCompact)
    case .roi: return film.returnOnBudget.map { "\(Formatters.multiple($0)) budget" }
    case .rt: return film.rtCriticsScore.map { "🍅 \($0)%" }
    case .rating: return film.letterboxdRating.map { "★ \(CollectionFormat.number($0))" }
    case .tmdbRating:
      return film.tmdbDetails?.voteAverage.map { "TMDB \(CollectionFormat.oneDecimal($0))" }
    case .price: return Formatters.price(film.pricePaid) ?? ""
    case .runtime: return film.runtimeMinutes.map(Formatters.runtime)
    default: return nil
    }
  }
}

/// The advanced filters (the web's `FILTER_DEFS`), in the web's order. The raw
/// value is the URL param key.
nonisolated enum CollectionFilter: String, CaseIterable, Identifiable, Sendable {
  case decade, format, hdr, region, label, packageType, edition, watched, tmdb

  var id: String { rawValue }

  var title: String {
    switch self {
    case .decade: "Decade"
    case .format: "Format"
    case .hdr: "HDR"
    case .region: "Region"
    case .label: "Publisher"
    case .packageType: "Package"
    case .edition: "Edition"
    case .watched: "Watched"
    case .tmdb: "TMDB"
    }
  }

  /// How the filter reads its value off a film.
  func value(of film: Film) -> String? {
    switch self {
    case .decade: film.decade
    case .format: film.format
    // No HDR value means SDR.
    case .hdr: film.hdr ?? "SDR"
    case .region: film.region
    case .label: film.label
    case .packageType: film.packageType
    case .edition: film.edition
    case .watched: film.isWatched ? "Watched" : "Unwatched"
    case .tmdb: film.tmdbId != nil ? "Matched" : "No match"
    }
  }
}

/// One choice in a filter, with how many films have it.
nonisolated struct CollectionFilterOption: Hashable, Sendable {
  let value: String
  let count: Int
}

/// The "Poster info" picker (the web's `OVERLAY_DEFS`): chips pinned to each
/// poster in grid view, values in each row in list view. The raw value is the
/// key stored in the comma-separated `overlay` param.
nonisolated enum CollectionOverlay: String, CaseIterable, Identifiable, Sendable {
  case rt, letterboxd, tmdbRating, price, budget, boxoffice, roi, runtime, publisher

  var id: String { rawValue }

  var label: String {
    switch self {
    case .rt: "RT scores"
    case .letterboxd: "My rating"
    case .tmdbRating: "TMDB rating"
    case .price: "Price paid"
    case .budget: "Budget"
    case .boxoffice: "Box office"
    case .roi: "Return on budget"
    case .runtime: "Runtime"
    case .publisher: "Publisher"
    }
  }

  /// The web's plain-text value — its list-view cell and default grid chip.
  func text(for film: Film) -> String? {
    switch self {
    case .rt:
      let parts = [
        film.rtCriticsScore.map { "🍅 \($0)%" },
        film.rtAudienceScore.map { "🍿 \($0)%" },
      ].compactMap(\.self)
      return parts.isEmpty ? nil : parts.joined(separator: " ")
    case .letterboxd:
      return film.letterboxdRating.map { "★ \(CollectionFormat.number($0))" }
    case .tmdbRating:
      return film.tmdbDetails?.voteAverage.map(CollectionFormat.oneDecimal)
    case .price:
      return Formatters.price(film.pricePaid)
    case .budget:
      return film.tmdbDetails?.budget.flatMap { $0 != 0 ? Formatters.usdCompact($0) : nil }
    case .boxoffice:
      return film.tmdbDetails?.revenue.flatMap { $0 != 0 ? Formatters.usdCompact($0) : nil }
    case .roi:
      return film.returnOnBudget.map(Formatters.multiple)
    case .runtime:
      return film.runtimeMinutes.map(Formatters.runtime)
    case .publisher:
      return film.label.flatMap { $0.isEmpty ? nil : $0 }
    }
  }

  /// Grid chips: RT gets one chip per score, everything else its text.
  func chips(for film: Film) -> [String] {
    switch self {
    case .rt:
      [film.rtCriticsScore.map { "🍅 \($0)%" }, film.rtAudienceScore.map { "🍿 \($0)%" }]
        .compactMap(\.self)
    default:
      text(for: film).map { [$0] } ?? []
    }
  }

  /// A list row has no column headers, so values that don't explain
  /// themselves get a short name.
  func listText(for film: Film) -> String? {
    guard let value = text(for: film) else { return nil }
    switch self {
    case .tmdbRating: return "TMDB \(value)"
    case .budget: return "\(value) budget"
    case .boxoffice: return "\(value) box office"
    case .roi: return "\(value) return"
    default: return value
    }
  }
}

/// All / Movies / TV. Unmatched titles count as movies.
nonisolated enum CollectionMediaType: String, CaseIterable, Sendable {
  case all, movie, tv
}

nonisolated enum CollectionLayout: String, Sendable {
  case grid, list
}

/// The collection's browse state and the logic that turns it into the
/// visible films — search, media type, filters, A–Z letter, and sort.
nonisolated struct CollectionQuery: Equatable, Sendable {
  /// The filter value meaning "no filter" (the web's `ANY`).
  static let any = "any"
  /// The A–Z browse letters (ALL is the absence of one).
  static let letters = ["#"] + "ABCDEFGHIJKLMNOPQRSTUVWXYZ".map(String.init)

  /// The browse state as the web keeps it in the URL: only non-default keys.
  private(set) var params: [String: String]

  init(params: [String: String] = [:]) {
    self.params = Self.sanitize(params)
  }

  // MARK: Reading the state

  var search: String { params["q"] ?? "" }
  var sort: CollectionSort { params["sort"].flatMap(CollectionSort.init) ?? .title }
  /// The explicit direction, set only when it's flipped from the default.
  var direction: SortDirection? { params["dir"].flatMap(SortDirection.init) }
  var effectiveDirection: SortDirection { direction ?? sort.defaultDirection }
  var letter: String? { params["letter"].flatMap { $0.isEmpty ? nil : $0 } }
  var layout: CollectionLayout { params["view"] == "list" ? .list : .grid }
  var mediaType: CollectionMediaType {
    params["type"].flatMap(CollectionMediaType.init) ?? .all
  }

  /// The chosen poster info, in the order it was picked (as stored).
  var overlayKeys: [CollectionOverlay] {
    var seen: [CollectionOverlay] = []
    for key in (params["overlay"] ?? "").split(separator: ",", omittingEmptySubsequences: false) {
      if let overlay = CollectionOverlay(rawValue: String(key)), !seen.contains(overlay) {
        seen.append(overlay)
      }
    }
    return seen
  }

  /// The chosen poster info, in display order.
  var activeOverlays: [CollectionOverlay] {
    let keys = overlayKeys
    return CollectionOverlay.allCases.filter(keys.contains)
  }

  func filterValue(_ filter: CollectionFilter) -> String {
    params[filter.rawValue] ?? Self.any
  }

  var activeFilterCount: Int {
    CollectionFilter.allCases.filter { filterValue($0) != Self.any }.count
  }

  /// The "Sorted by …" caption for a metric sort.
  var metricCaption: String? {
    guard let metric = sort.metricLabel else { return nil }
    let end = effectiveDirection == .desc ? "highest" : "lowest"
    return "Sorted by \(sort.label.lowercased()), \(end) first — titles without \(metric) sort last"
  }

  /// The metric a card or row shows for the active sort.
  func subtext(for film: Film) -> String? {
    sort.isMetric ? sort.metricSubtext(film) : nil
  }

  // MARK: Changing the state

  /// Merge a change into the state (the web's `setParams`): nil, empty, and
  /// "any" remove the key, so defaults are never stored.
  mutating func set(_ key: String, _ value: String?) {
    if let value, !value.isEmpty, value != Self.any {
      params[key] = value
    } else {
      params.removeValue(forKey: key)
    }
  }

  /// The search box sends its text trimmed; an empty search removes `q`.
  mutating func setSearch(_ text: String) {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.isEmpty {
      params.removeValue(forKey: "q")
    } else {
      params["q"] = trimmed
    }
  }

  /// Pick a sort, or flip the direction when it's already the active one.
  /// A new sort resets the direction and the A–Z letter.
  mutating func selectSort(_ key: CollectionSort) {
    if sort == key {
      let flipped: SortDirection = key.defaultDirection == .asc ? .desc : .asc
      set("dir", direction == nil ? flipped.rawValue : nil)
    } else {
      set("sort", key == .title ? nil : key.rawValue)
      set("dir", nil)
      set("letter", nil)
    }
  }

  mutating func toggleOverlay(_ overlay: CollectionOverlay) {
    var keys = overlayKeys
    if let index = keys.firstIndex(of: overlay) {
      keys.remove(at: index)
    } else {
      keys.append(overlay)
    }
    set("overlay", keys.isEmpty ? nil : keys.map(\.rawValue).joined(separator: ","))
  }

  mutating func setFilter(_ filter: CollectionFilter, _ value: String) {
    set(filter.rawValue, value)
  }

  mutating func clearFilters() {
    for filter in CollectionFilter.allCases { set(filter.rawValue, nil) }
  }

  /// Tapping the active letter goes back to ALL.
  mutating func toggleLetter(_ value: String?) {
    set("letter", value == letter ? nil : value)
  }

  mutating func setLayout(_ layout: CollectionLayout) {
    set("view", layout == .grid ? nil : layout.rawValue)
  }

  mutating func setMediaType(_ type: CollectionMediaType) {
    set("type", type == .all ? nil : type.rawValue)
  }

  // MARK: The visible films

  /// Sort, then narrow by media type, search, filters, and letter.
  func visible(_ films: [Film]) -> [Film] {
    var list = Self.sortFilms(films, by: sort, direction: direction)
    switch mediaType {
    case .all: break
    case .tv: list = list.filter(\.isTV)
    case .movie: list = list.filter { !$0.isTV }
    }
    let q = search.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    if !q.isEmpty {
      list = list.filter { film in
        film.title.lowercased().contains(q)
          || film.director?.lowercased().contains(q) == true
          || film.label?.lowercased().contains(q) == true
          || film.spineNumber.map { "#\($0)".contains(q) } == true
      }
    }
    for filter in CollectionFilter.allCases {
      let wanted = filterValue(filter)
      if wanted == Self.any { continue }
      list = list.filter { filter.value(of: $0) == wanted }
    }
    if let letter, sort == .title {
      list = list.filter { $0.sortLetter == letter }
    }
    return list
  }

  /// The web's `sortFilms`. `films` arrive in server order (sort title,
  /// then year), which is the alphabetical sort. Films missing the sorted
  /// value stay visible but always sink to the bottom — flipping direction
  /// only reorders the films that have it. Ties keep their input order.
  static func sortFilms(
    _ films: [Film], by sort: CollectionSort, direction: SortDirection?
  ) -> [Film] {
    let flip = direction != nil && direction != sort.defaultDirection

    func byNumber(descending: Bool, _ valueOf: (Film) -> Double?) -> [Film] {
      stableSorted(films) { a, b in
        switch (valueOf(a), valueOf(b)) {
        case (nil, nil): return 0
        case (nil, _): return 1
        case (_, nil): return -1
        case (let av?, let bv?):
          let cmp = descending ? compare(bv, av) : compare(av, bv)
          return flip ? -cmp : cmp
        }
      }
    }

    if sort.isMetric {
      return byNumber(descending: true, sort.metricValue)
    }
    switch sort {
    case .spine:
      return byNumber(descending: false) { $0.spineNumber.map(Double.init) }
    case .year:
      return byNumber(descending: false) { $0.year.map(Double.init) }
    case .added:
      return byNumber(descending: true) { $0.createdAt.timeIntervalSince1970 }
    case .publisher:
      return stableSorted(films) { a, b in
        switch (a.label, b.label) {
        case (nil, nil): return 0
        case (nil, _): return 1
        case (_, nil): return -1
        case (let al?, let bl?):
          let cmp = al.localizedCompare(bl).rawValue
          return flip ? -cmp : cmp
        }
      }
    case .format:
      // An unknown format sorts before the known ones, as indexOf's -1 does.
      return byNumber(descending: false) {
        Double(FilmVocabulary.formats.firstIndex(of: $0.format) ?? -1)
      }
    default:
      return flip ? films.reversed() : films
    }
  }

  /// Distinct values (with counts) present in the collection, per filter,
  /// in natural order ("1950s" before "1960s", "2" before "10").
  static func filterOptions(_ films: [Film]) -> [CollectionFilter: [CollectionFilterOption]] {
    var result: [CollectionFilter: [CollectionFilterOption]] = [:]
    for filter in CollectionFilter.allCases {
      var counts: [String: Int] = [:]
      for film in films {
        guard let value = filter.value(of: film), !value.isEmpty else { continue }
        counts[value, default: 0] += 1
      }
      result[filter] = counts
        .map { CollectionFilterOption(value: $0.key, count: $0.value) }
        .sorted { $0.value.localizedStandardCompare($1.value) == .orderedAscending }
    }
    return result
  }

  /// The A–Z letters that have at least one film.
  static func presentLetters(_ films: [Film]) -> Set<String> {
    Set(films.map(\.sortLetter))
  }

  // MARK: Saved views

  /// Keep only params a saved view can restore — drops junk and stale keys
  /// (the web's `sanitizeViewParams`, validating as its search schema does).
  static func sanitize(_ params: [String: String]) -> [String: String] {
    params.filter { isValid(key: $0.key, value: $0.value) }
  }

  /// Two browse states are the same view (the web's `paramsEqual`).
  static func paramsEqual(_ a: [String: String], _ b: [String: String]) -> Bool {
    a == b
  }

  private static func isValid(key: String, value: String) -> Bool {
    switch key {
    case "q", "decade", "format", "hdr", "region", "label", "packageType", "edition",
      "watched", "tmdb", "overlay":
      true
    case "sort": CollectionSort(rawValue: value) != nil
    case "dir": SortDirection(rawValue: value) != nil
    // z.string().max(1) counts UTF-16 units.
    case "letter": value.utf16.count <= 1
    case "view": CollectionLayout(rawValue: value) != nil
    case "type": value == CollectionMediaType.movie.rawValue || value == CollectionMediaType.tv.rawValue
    default: false
    }
  }

  // MARK: Helpers

  private static func compare(_ a: Double, _ b: Double) -> Int {
    a < b ? -1 : (a > b ? 1 : 0)
  }

  /// Sort with a three-way comparator, keeping ties in input order (as JS's
  /// stable `Array.sort` does).
  private static func stableSorted(_ films: [Film], by compare: (Film, Film) -> Int) -> [Film] {
    films.enumerated()
      .sorted { lhs, rhs in
        let cmp = compare(lhs.element, rhs.element)
        return cmp != 0 ? cmp < 0 : lhs.offset < rhs.offset
      }
      .map(\.element)
  }
}

/// Number formats that mirror JavaScript's output, so a value reads the same
/// as on the web.
nonisolated enum CollectionFormat {
  /// JS `String(n)`: 4 → "4", 3.5 → "3.5".
  static func number(_ value: Double) -> String {
    value == value.rounded() && abs(value) < 1e15 ? String(Int(value)) : String(value)
  }

  /// JS `n.toFixed(1)`.
  static func oneDecimal(_ value: Double) -> String {
    String(format: "%.1f", value)
  }
}

/// Saved-view list edits, ported from the web's collection page. Each returns
/// the full new list, which the client sends to `saveViews` whole.
nonisolated enum CollectionSavedViews {
  /// The saved view whose state is the current one.
  static func active(in views: [SavedView], matching params: [String: String]) -> SavedView? {
    views.first { CollectionQuery.paramsEqual(CollectionQuery.sanitize($0.params), params) }
  }

  /// Save `params` under `name` (trimmed by the caller). Reusing a name
  /// overwrites that view; only one view can be the default.
  static func saving(
    _ views: [SavedView], name: String, params: [String: String], isDefault: Bool
  ) -> [SavedView] {
    let view = SavedView(name: name, params: params, isDefault: isDefault ? true : nil)
    let others = views
      .filter { $0.name != name }
      .map { other -> SavedView in
        guard isDefault else { return other }
        var other = other
        other.isDefault = nil
        return other
      }
    return others + [view]
  }

  /// Rename `from` to `to` (trimmed by the caller). Renaming onto an existing
  /// name overwrites that view.
  static func renaming(_ views: [SavedView], from: String, to: String) -> [SavedView] {
    views
      .filter { $0.name != to || $0.name == from }
      .map { view in
        guard view.name == from else { return view }
        var renamed = view
        renamed.name = to
        return renamed
      }
  }

  /// Star or unstar `name` as the default; every other view loses it.
  static func togglingDefault(_ views: [SavedView], name: String) -> [SavedView] {
    views.map { view in
      var view = view
      view.isDefault = view.name == name && view.isDefault != true ? true : nil
      return view
    }
  }

  static func deleting(_ views: [SavedView], name: String) -> [SavedView] {
    views.filter { $0.name != name }
  }
}
