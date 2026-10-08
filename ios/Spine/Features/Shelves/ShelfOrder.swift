import Foundation

/// Checking a photographed shelf against its digital twin: which discs
/// stand where the shelf's order puts them, which are out of place (and
/// where each goes), and which belong on another shelf. Spines arrive in
/// reading order — left to right for an upright shelf, top to bottom for a
/// stack — which is the shelf's order from first to last.
///
/// A port of src/lib/shelf-order.ts, on top of `ShelfEngine.assign`; keep
/// the two in step.
nonisolated enum ShelfOrder {
  enum Placement: String, Hashable, Sendable {
    /// Where the shelf's order expects it.
    case inOrder = "in-order"
    /// Belongs on this shelf, but somewhere else along it.
    case outOfOrder = "out-of-order"
    /// Belongs on a different shelf.
    case otherShelf = "other-shelf"
    /// Catalogued, but no shelf claims it.
    case unshelved
    /// Not in the collection (in this format).
    case notCatalogued = "not-catalogued"
  }

  struct PlacedSpine: Hashable, Sendable {
    var spine: ShelfSpine
    var placement: Placement
    /// The catalogued film this spine is, when it is one.
    var film: Film?
    /// Out of order: the in-place disc it goes after (nil = the start).
    var moveAfter: Film?
    /// Out of order: the in-place disc it goes before (nil = the end).
    var moveBefore: Film?
    /// Other shelf: the shelf it belongs on.
    var belongsOn: Shelf?
  }

  struct Check: Sendable {
    var shelf: Shelf
    /// Every spine, in reading order, repeats from overlapping photos removed.
    var spines: [PlacedSpine]
    /// Discs the shelf should hold between the first and last in-place
    /// discs photographed that the photos don't show — moved, lent, or
    /// misfiled.
    var absent: [Film]

    var moves: [PlacedSpine] { spines.filter { $0.placement == .outOfOrder } }
    var inOrderCount: Int { spines.count(where: { $0.placement == .inOrder }) }
  }

  /// The catalogued film a spine is, when the photo shows that exact
  /// edition.
  private static func spineFilm(_ spine: ShelfSpine, _ byID: [String: Film]) -> Film? {
    guard spine.status == .owned, let film = spine.film else { return nil }
    return byID[film.id]
  }

  /// The shelf a photo most likely shows: the one that's home to the most
  /// of its catalogued spines. Nil when none of them is shelved.
  static func guessPhotographedShelf(
    _ spines: [ShelfSpine], films: [Film], shelves: [Shelf]
  ) -> Shelf? {
    let assignment = ShelfEngine.assign(films, to: shelves)
    var homeOf: [String: String] = [:]
    for shelf in shelves {
      for film in assignment.films(on: shelf) { homeOf[film.id] = shelf.id }
    }
    var votes: [String: Int] = [:]
    for spine in spines {
      guard spine.status == .owned, let id = spine.film?.id, let home = homeOf[id] else {
        continue
      }
      votes[home, default: 0] += 1
    }
    var best: Shelf?
    for shelf in shelves {
      let count = votes[shelf.id] ?? 0
      if count > 0, best.map({ count > (votes[$0.id] ?? 0) }) ?? true { best = shelf }
    }
    return best
  }

  static func check(
    _ spines: [ShelfSpine], shelf: Shelf, films: [Film], shelves: [Shelf]
  ) -> Check {
    var byID: [String: Film] = [:]
    for film in films { byID[film.id] = film }
    let assignment = ShelfEngine.assign(films, to: shelves)
    let expected = assignment.byShelf[shelf.id] ?? []
    var position: [String: Int] = [:]
    for (index, film) in expected.enumerated() { position[film.id] = index }
    let rank = { (film: Film) in position[film.id] ?? -1 }
    var homeOf: [String: Shelf] = [:]
    for other in shelves {
      for film in assignment.byShelf[other.id] ?? [] { homeOf[film.id] = other }
    }

    // Overlapping photos show the same disc twice; keep its first sighting.
    var seen = Set<String>()
    let unique = spines.filter { spine in
      guard let film = spineFilm(spine, byID) else { return true }
      return seen.insert(film.id).inserted
    }

    // The longest run already in shelf order stays put; everything else on
    // this shelf moves. That's the fewest moves that put the shelf right.
    let onShelf: [(index: Int, film: Film)] = unique.enumerated().compactMap { index, spine in
      guard let film = spineFilm(spine, byID), position[film.id] != nil else { return nil }
      return (index, film)
    }
    let keep = longestIncreasingRun(onShelf.map { rank($0.film) })
    let inPlace = Set(keep.map { onShelf[$0].index })
    let anchors = keep.map { onShelf[$0].film }.sorted { rank($0) < rank($1) }

    let placed = unique.enumerated().map { index, spine -> PlacedSpine in
      let film = spineFilm(spine, byID)
      var result = PlacedSpine(spine: spine, placement: .notCatalogued, film: film)
      guard let film else { return result }
      if position[film.id] != nil {
        if inPlace.contains(index) {
          result.placement = .inOrder
          return result
        }
        let target = rank(film)
        result.placement = .outOfOrder
        result.moveAfter = anchors.last { rank($0) < target }
        result.moveBefore = anchors.first { rank($0) > target }
        return result
      }
      if let home = homeOf[film.id] {
        result.placement = .otherShelf
        result.belongsOn = home
      } else {
        result.placement = .unshelved
      }
      return result
    }

    var absent: [Film] = []
    if let first = anchors.first, let last = anchors.last {
      absent = expected[rank(first)...rank(last)].filter { !seen.contains($0.id) }
    }
    return Check(shelf: shelf, spines: placed, absent: absent)
  }

  /// Indexes into `values` of one longest strictly increasing subsequence
  /// (patience sorting, O(n log n)).
  static func longestIncreasingRun(_ values: [Int]) -> [Int] {
    var tails: [Int] = []
    var previous = [Int](repeating: -1, count: values.count)
    for i in values.indices {
      var lo = 0
      var hi = tails.count
      while lo < hi {
        let mid = (lo + hi) >> 1
        if values[tails[mid]] < values[i] { lo = mid + 1 } else { hi = mid }
      }
      if lo > 0 { previous[i] = tails[lo - 1] }
      if lo == tails.count { tails.append(i) } else { tails[lo] = i }
    }
    var run: [Int] = []
    var i = tails.last ?? -1
    while i != -1 {
      run.append(i)
      i = previous[i]
    }
    return run.reversed()
  }
}
