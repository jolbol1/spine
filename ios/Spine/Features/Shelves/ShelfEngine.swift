import Foundation

/// Shelves are an ordered partition of the collection: every film lives on
/// exactly one shelf — the first one (top to bottom) it matches — so shelf
/// order doubles as rule precedence. A boutique shelf above the format
/// shelves claims its Criterion 4Ks before the 4K shelf can.
///
/// A line-for-line port of src/lib/shelves.ts; keep the two in step.
nonisolated enum ShelfEngine {
  static let ruleFields: [(field: ShelfRuleField, label: String)] = [
    (.format, "Format"),
    (.mediaType, "Type"),
    (.label, "Publisher"),
    (.edition, "Edition"),
    (.packageType, "Package"),
    (.hdr, "HDR"),
    (.region, "Region"),
    (.decade, "Decade"),
    (.watched, "Watched"),
    (.genre, "Genre"),
  ]

  static let sortKeys: [(key: ShelfSortKey, label: String)] = [
    (.title, "Title"),
    (.spine, "Criterion spine #"),
    (.year, "Release year"),
    (.added, "Date added"),
    (.publisher, "Publisher"),
    (.runtime, "Runtime"),
  ]

  static let groupByOptions: [(value: ShelfGroupBy?, label: String)] = [
    (nil, "No grouping"),
    (.label, "Publisher"),
    (.format, "Format"),
    (.decade, "Decade"),
  ]

  static func label(for field: ShelfRuleField) -> String {
    ruleFields.first { $0.field == field }?.label ?? field.rawValue
  }

  static func label(for key: ShelfSortKey) -> String {
    sortKeys.first { $0.key == key }?.label ?? key.rawValue
  }

  static func label(for groupBy: ShelfGroupBy?) -> String {
    groupByOptions.first { $0.value == groupBy }?.label ?? "No grouping"
  }

  private static let defaultSort: [ShelfSortLevel] = [ShelfSortLevel(key: .title)]

  /// Default direction per key — "added" reads newest-first like the app.
  static func defaultDirection(for key: ShelfSortKey) -> SortDirection {
    key == .added ? .desc : .asc
  }

  // MARK: Rules

  /// A film's value for a rule field. Genres return every genre; unmatched
  /// titles count as movies (physical shelves are mostly films) and missing
  /// HDR means SDR, both consistent with the collection page filters.
  static func fieldValues(_ film: Film, _ field: ShelfRuleField) -> [String] {
    switch field {
    case .format: [film.format]
    case .mediaType: [film.tmdbMediaType == "tv" ? "TV" : "Movie"]
    case .label: present(film.label)
    case .edition: present(film.edition)
    case .packageType: present(film.packageType)
    case .hdr: [film.hdr ?? "SDR"]
    case .region: present(film.region)
    case .decade: film.year.map { [decade($0)] } ?? []
    case .watched: [film.isWatched ? "Watched" : "Unwatched"]
    case .genre: film.tmdbDetails?.genres ?? []
    }
  }

  /// Rules with no values are builder drafts — they match everything.
  private static func ruleMatches(_ film: Film, _ rule: ShelfRule) -> Bool {
    rule.values.isEmpty || fieldValues(film, rule.field).contains { rule.values.contains($0) }
  }

  /// Rules only — ignores pins and exclusions.
  static func matchesRules(_ film: Film, _ shelf: Shelf) -> Bool {
    shelf.rules.allSatisfy { ruleMatches(film, $0) }
  }

  // MARK: Ordering

  /// Multi-level comparator; films missing a value sink below either dir.
  private static func compare(_ a: Film, _ b: Film, _ levels: [ShelfSortLevel]) -> Int {
    for level in levels {
      let sign = (level.dir ?? defaultDirection(for: level.key)) == .desc ? -1 : 1
      let order: LevelOrder
      switch level.key {
      case .title: order = compareValues(a.sortTitle, b.sortTitle)
      case .spine: order = compareValues(a.spineNumber, b.spineNumber)
      case .year: order = compareValues(a.year, b.year)
      case .added: order = compareValues(a.createdAt, b.createdAt)
      case .publisher: order = compareValues(a.label, b.label)
      case .runtime: order = compareValues(a.runtimeMinutes, b.runtimeMinutes)
      }
      switch order {
      case .bothMissing: continue
      case .aMissing: return 1
      case .bMissing: return -1
      case .compared(let cmp): if cmp != 0 { return sign * cmp }
      }
    }
    return localeCompare(a.sortTitle, b.sortTitle)
  }

  private enum LevelOrder {
    case bothMissing, aMissing, bMissing
    case compared(Int)
  }

  private static func compareValues<T: Comparable>(_ a: T?, _ b: T?) -> LevelOrder {
    guard let a else { return b == nil ? .bothMissing : .aMissing }
    guard let b else { return .bMissing }
    return .compared(a < b ? -1 : (a > b ? 1 : 0))
  }

  /// Strings compare like `localeCompare(…, { numeric: true })`.
  private static func compareValues(_ a: String?, _ b: String?) -> LevelOrder {
    guard let a else { return b == nil ? .bothMissing : .aMissing }
    guard let b else { return .bMissing }
    return .compared(localeCompare(a, b, numeric: true))
  }

  /// The visual sub-group a film belongs to on a shelf, if grouping is on.
  static func groupKey(_ film: Film, _ shelf: Shelf) -> String? {
    switch shelf.groupBy {
    case .label?: film.label
    case .format?: film.format
    case .decade?: film.year.map(decade)
    case nil: nil
    }
  }

  /// Display order for a shelf's films: multi-level sort, then contiguous
  /// sub-groups (alphabetical, ungrouped last), then any hand-arranged ids
  /// pulled to the front in their saved order.
  static func orderFilms(_ shelf: Shelf, _ films: [Film]) -> [Film] {
    let levels = if let sort = shelf.sort, !sort.isEmpty { sort } else { defaultSort }
    var ordered = stableSorted(films) { compare($0, $1, levels) }

    if shelf.groupBy != nil {
      var keys: [String?] = []
      var groups: [String?: [Film]] = [:]
      for film in ordered {
        let key = groupKey(film, shelf)
        if groups[key] == nil { keys.append(key) }
        groups[key, default: []].append(film)
      }
      let sortedKeys = stableSorted(keys) { a, b in
        guard let a else { return 1 }
        guard let b else { return -1 }
        return localeCompare(a, b, numeric: true)
      }
      ordered = sortedKeys.flatMap { groups[$0] ?? [] }
    }

    if let manual = shelf.manualOrder, !manual.isEmpty {
      var rank: [String: Int] = [:]
      for (index, id) in manual.enumerated() where rank[id] == nil { rank[id] = index }
      let placed = stableSorted(ordered.filter { rank[$0.id] != nil }) {
        rank[$0.id]! - rank[$1.id]!
      }
      return placed + ordered.filter { rank[$0.id] == nil }
    }
    return ordered
  }

  // MARK: Assignment

  struct Assignment {
    /// shelf id → films in display order.
    var byShelf: [String: [Film]]
    /// Films no shelf claims — the tray, so nothing silently vanishes.
    var unshelved: [Film]

    func films(on shelf: Shelf) -> [Film] { byShelf[shelf.id] ?? [] }
  }

  /// Partition the collection across the shelves. Pins win over any rule
  /// match (a film pinned to shelf 3 stays there even if shelf 1's rules
  /// match it); otherwise the first non-excluding rule match claims the film.
  static func assign(_ films: [Film], to shelves: [Shelf]) -> Assignment {
    var byShelf: [String: [Film]] = [:]
    for shelf in shelves { byShelf[shelf.id] = [] }
    var unshelved: [Film] = []

    var pinnedTo: [String: String] = [:]
    for shelf in shelves {
      for id in shelf.pinned ?? [] where pinnedTo[id] == nil {
        pinnedTo[id] = shelf.id
      }
    }

    for film in films {
      if let pinnedShelf = pinnedTo[film.id] {
        byShelf[pinnedShelf, default: []].append(film)
        continue
      }
      let home = shelves.first { shelf in
        !(shelf.excluded ?? []).contains(film.id) && matchesRules(film, shelf)
      }
      if let home {
        byShelf[home.id, default: []].append(film)
      } else {
        unshelved.append(film)
      }
    }

    for shelf in shelves {
      byShelf[shelf.id] = orderFilms(shelf, byShelf[shelf.id] ?? [])
    }
    unshelved = stableSorted(unshelved) { localeCompare($0.sortTitle, $1.sortTitle) }
    return Assignment(byShelf: byShelf, unshelved: unshelved)
  }

  /// Films past the shelf's physical capacity — the suggested spill.
  static func overflow(_ shelf: Shelf, _ ordered: [Film]) -> [Film] {
    guard let capacity = shelf.capacity, capacity > 0 else { return [] }
    return Array(ordered.dropFirst(capacity))
  }

  /// Added since the shelf was last physically arranged.
  static func isNewSinceArranged(_ shelf: Shelf, _ film: Film) -> Bool {
    guard let raw = shelf.arrangedAt, let arranged = JSONCoding.parseDate(raw) else {
      return false
    }
    return film.createdAt > arranged
  }

  // MARK: Wishlist ghosts
  //
  // Translucent covers showing where a purchase would go. Wishlist items only
  // carry title/year/format, so a shelf can host ghosts only when every rule
  // tests a field a wishlist item has; richer rules (publisher, package…)
  // can't be evaluated and match no ghosts.

  private static func wishlistFieldValues(_ item: WishlistItem, _ field: ShelfRuleField)
    -> [String]?
  {
    switch field {
    case .format: present(item.format)
    case .mediaType: ["Movie"]
    case .decade: item.year.map { [decade($0)] } ?? []
    default: nil
    }
  }

  private static func wishlistMatches(_ item: WishlistItem, _ shelf: Shelf) -> Bool {
    shelf.rules.allSatisfy { rule in
      if rule.values.isEmpty { return true }
      guard let values = wishlistFieldValues(item, rule.field) else { return false }
      return values.contains { rule.values.contains($0) }
    }
  }

  /// First-match assignment for wishlist items, mirroring the films.
  static func assignWishlist(_ items: [WishlistItem], to shelves: [Shelf])
    -> [String: [WishlistItem]]
  {
    var byShelf: [String: [WishlistItem]] = [:]
    for item in items {
      guard let home = shelves.first(where: { wishlistMatches(item, $0) }) else { continue }
      byShelf[home.id, default: []].append(item)
    }
    return byShelf
  }

  /// Where a ghost would slot into the shelf's current order, by title.
  static func ghostInsertionIndex(_ ordered: [Film], _ item: WishlistItem) -> Int {
    let ghostTitle = Film.sortTitle(for: item.title)
    return ordered.firstIndex { localeCompare($0.sortTitle, ghostTitle) > 0 } ?? ordered.count
  }

  // MARK: Templates

  /// Boutique/collector labels — matched loosely against collection labels.
  static let boutiqueLabels = [
    "criterion", "arrow", "mubi", "curzon", "kino lorber", "eureka",
    "masters of cinema", "second sight", "88 films", "bfi", "indicator",
    "powerhouse", "vinegar syndrome", "imprint", "shout factory",
    "shout! factory", "scream factory", "radiance", "severin", "terracotta",
    "third window",
  ]

  /// Distinct collection labels that look boutique (e.g. "Curzon Film World").
  static func boutiqueLabels(in films: [Film]) -> [String] {
    var labels = Set<String>()
    for film in films {
      guard let label = film.label, !label.isEmpty else { continue }
      let lowered = label.lowercased()
      if boutiqueLabels.contains(where: { lowered.contains($0) }) { labels.insert(label) }
    }
    return stableSorted(Array(labels)) { localeCompare($0, $1) }
  }

  private static let formatShelves: [(name: String, format: String)] = [
    ("4K UHD", "4K UHD"),
    ("Blu-ray", "Blu-ray"),
    ("DVD", "DVD"),
  ]

  /// Starter shelves for a template. The boutique template mirrors the
  /// classic collector layout: boutique labels (Criterion sorted by spine via
  /// a spine-first sort) claim their titles before the format shelves, and
  /// TV box sets sit apart from the movie shelves.
  static func templateShelves(
    _ template: ShelfTemplate, films: [Film],
    newID: () -> String = { UUID().uuidString.lowercased() }
  ) -> [Shelf] {
    switch template {
    case .boutique:
      let boutique = boutiqueLabels(in: films)
      var shelves: [Shelf] = []
      if !boutique.isEmpty {
        shelves.append(
          Shelf(
            id: newID(), name: "Boutique editions",
            rules: [ShelfRule(field: .label, values: boutique)],
            sort: [ShelfSortLevel(key: .spine), ShelfSortLevel(key: .title)],
            groupBy: .label))
      }
      for (name, format) in formatShelves {
        shelves.append(
          Shelf(
            id: newID(), name: name,
            rules: [
              ShelfRule(field: .format, values: [format]),
              ShelfRule(field: .mediaType, values: ["Movie"]),
            ]))
      }
      shelves.append(
        Shelf(
          id: newID(), name: "TV box sets",
          rules: [ShelfRule(field: .mediaType, values: ["TV"])]))
      return shelves
    case .formats:
      return formatShelves.map { name, format in
        Shelf(id: newID(), name: name, rules: [ShelfRule(field: .format, values: [format])])
      }
    case .everything:
      return [Shelf(id: newID(), name: "Collection", rules: [])]
    }
  }

  /// Distinct values (with counts) the collection has for a rule field.
  static func fieldOptions(_ films: [Film], _ field: ShelfRuleField) -> [(
    value: String, count: Int
  )] {
    var counts: [String: Int] = [:]
    for film in films {
      for value in fieldValues(film, field) { counts[value, default: 0] += 1 }
    }
    return stableSorted(counts.map { (value: $0.key, count: $0.value) }) {
      localeCompare($0.value, $1.value, numeric: true)
    }
  }

  // MARK: Helpers

  /// JS truthiness for an optional string: nil and "" are both absent.
  private static func present(_ value: String?) -> [String] {
    guard let value, !value.isEmpty else { return [] }
    return [value]
  }

  private static func decade(_ year: Int) -> String {
    "\(Int((Double(year) / 10).rounded(.down)) * 10)s"
  }

  /// `String.prototype.localeCompare`, optionally with `{ numeric: true }`.
  static func localeCompare(_ a: String, _ b: String, numeric: Bool = false) -> Int {
    switch a.compare(b, options: numeric ? [.numeric] : [], locale: .current) {
    case .orderedAscending: -1
    case .orderedDescending: 1
    case .orderedSame: 0
    }
  }

  /// JS's `Array.prototype.sort` is stable; Swift's `sort` doesn't promise
  /// to be, so ties fall back to the original position.
  static func stableSorted<T>(_ items: [T], by compare: (T, T) -> Int) -> [T] {
    items.enumerated()
      .sorted { lhs, rhs in
        let cmp = compare(lhs.element, rhs.element)
        return cmp != 0 ? cmp < 0 : lhs.offset < rhs.offset
      }
      .map(\.element)
  }
}

/// A starter layout offered on the empty page and in the Templates menu.
nonisolated enum ShelfTemplate: String, CaseIterable, Identifiable, Sendable {
  case boutique, formats, everything

  var id: String { rawValue }

  var label: String {
    switch self {
    case .boutique: "Boutique + formats + TV"
    case .formats: "By format"
    case .everything: "Single shelf"
    }
  }

  var summary: String {
    switch self {
    case .boutique: "Boutique labels first, then 4K / Blu-ray / DVD movies, TV box sets last"
    case .formats: "One shelf per disc format"
    case .everything: "Everything on one alphabetical shelf"
    }
  }
}
