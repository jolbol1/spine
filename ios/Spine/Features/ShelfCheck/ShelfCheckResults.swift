import Foundation

/// Spines from several shelf photos, merged and sorted into what the shelf
/// check shows — a port of src/lib/shelf-check.ts; keep the two in step.
/// Pure, so it can be checked without the app.
nonisolated enum ShelfCheckResults {
  /// One disc seen on the shelf — once, however many photos it's in.
  struct Entry: Identifiable, Hashable, Sendable {
    /// Unique within the list: the spine's key, or its position when its
    /// title is unreadable.
    let id: String
    var spine: ShelfSpine
    /// For a spine read as missing or in another format: the copy
    /// catalogued since, so the row reads "Added ✓".
    var added: Film?
  }

  struct Sections: Sendable {
    var missing: [Entry] = []
    var otherFormat: [Entry] = []
    var owned: [Entry] = []

    var isEmpty: Bool { missing.isEmpty && otherFormat.isEmpty && owned.isEmpty }
  }

  /// The same spine seen twice — in overlapping photos of one shelf —
  /// shares this key. Unreadable titles get none, so they're never merged.
  static func spineKey(_ spine: ShelfSpine) -> String? {
    let key = CollectionMatch.titleKey(spine.title)
    guard !key.isEmpty else { return nil }
    return "\(key)|\(spine.format ?? "")|\(spine.year.map(String.init) ?? "")"
  }

  /// Every photo's spines as one list in reading order, each spine once.
  /// When overlapping photos both show a spine, the clearer reading wins
  /// and the other fills in any label, spine number, or catalogue match it
  /// lacked.
  static func merge(_ photos: [[ShelfSpine]]) -> [Entry] {
    var merged: [ShelfSpine] = []
    var keys: [String?] = []
    var indexByKey: [String: Int] = [:]
    for spine in photos.joined() {
      let key = spineKey(spine)
      guard let key, let index = indexByKey[key] else {
        if let key { indexByKey[key] = merged.count }
        merged.append(spine)
        keys.append(key)
        continue
      }
      let kept = merged[index]
      let (best, other) =
        rank(spine.legibility) < rank(kept.legibility) ? (spine, kept) : (kept, spine)
      var combined = best
      combined.label = best.label ?? other.label
      combined.spineNumber = best.spineNumber ?? other.spineNumber
      combined.film = best.film ?? other.film
      combined.status = best.film != nil ? best.status : other.status
      merged[index] = combined
    }
    return merged.enumerated().map { index, spine in
      Entry(id: keys[index] ?? "unreadable-\(index)", spine: spine)
    }
  }

  /// Every photo's spines in order, as the shelf order check wants them.
  /// The check drops a catalogued disc seen again in an overlapping photo
  /// itself; an uncatalogued one has no id to go by, so a spine the
  /// previous photo also showed is dropped here. Within one photo, repeats
  /// are kept — they may be two copies side by side.
  static func joinPhotos(_ photos: [[ShelfSpine]]) -> [ShelfSpine] {
    let uncatalogued = { (spine: ShelfSpine) in spine.status != .owned || spine.film == nil }
    return photos.enumerated().flatMap { index, spines -> [ShelfSpine] in
      guard index > 0 else { return spines }
      let previous = Set(photos[index - 1].filter(uncatalogued).compactMap(spineKey))
      return spines.filter { spine in
        guard uncatalogued(spine), let key = spineKey(spine) else { return true }
        return !previous.contains(key)
      }
    }
  }

  /// For a spine read as missing or in another format: the copy catalogued
  /// since the photo was read, found again with `CollectionMatch` so it
  /// shows as added without reading the photo again. Read as missing, any
  /// copy now is new; in another format, only a copy in the spine's format.
  static func addedSince(_ spine: ShelfSpine, films: [Film]) -> Film? {
    guard spine.status != .owned else { return nil }
    let matches = CollectionMatch.duplicates(
      in: films, of: .init(title: spine.title, year: spine.year, format: spine.format))
    let added =
      spine.status == .missing
      ? matches.first : matches.first { $0.reason == .sameFormat }
    return added?.film
  }

  /// Sort the spines into sections against the collection as it is now.
  static func sections(_ entries: [Entry], films: [Film]) -> Sections {
    var sections = Sections()
    for var entry in entries {
      entry.added = addedSince(entry.spine, films: films)
      switch entry.spine.status {
      case .owned: sections.owned.append(entry)
      case .otherFormat: sections.otherFormat.append(entry)
      case .missing: sections.missing.append(entry)
      }
    }
    return sections
  }

  private static func rank(_ legibility: ShelfSpine.Legibility) -> Int {
    switch legibility {
    case .clear: 0
    case .partial: 1
    case .unclear: 2
    }
  }
}
