import Foundation

/// The order check's words, as the web puts them (src/lib/shelf-moves.ts).
nonisolated enum ShelfOrderWords {
  /// A piece of a sentence: plain words, or a disc whose title is
  /// emphasised.
  enum Phrase: Equatable {
    case text(String)
    case film(Film)
  }

  /// Where an out-of-place disc goes: "Move Dune between Cure and
  /// Eraserhead". An upright shelf runs from its start to its end; a stack
  /// from its top, so a disc goes "to the top, above" rather than "to the
  /// start, before".
  static func moveSentence(_ placed: ShelfOrder.PlacedSpine, stacked: Bool) -> [Phrase]? {
    guard placed.placement == .outOfOrder, let film = placed.film else { return nil }
    let (start, end, before, after) =
      stacked ? ("top", "bottom", "above", "below") : ("start", "end", "before", "after")
    var phrases: [Phrase] = [.text("Move "), .film(film)]
    switch (placed.moveAfter, placed.moveBefore) {
    case (let a?, let b?): phrases += [.text(" between "), .film(a), .text(" and "), .film(b)]
    case (nil, let b?): phrases += [.text(" to the \(start), \(before) "), .film(b)]
    case (let a?, nil): phrases += [.text(" to the \(end), \(after) "), .film(a)]
    case (nil, nil): phrases.append(.text(" back into the shelf’s order"))
    }
    return phrases
  }

  static func text(_ phrases: [Phrase]) -> String {
    phrases.map {
      switch $0 {
      case .text(let words): words
      case .film(let film): film.title
      }
    }.joined()
  }

  /// The photographed stretch can be marked arranged: something of this
  /// shelf's is there, nothing needs moving, and nothing from another
  /// shelf is in the way.
  static func isInOrder(_ check: ShelfOrder.Check) -> Bool {
    check.inOrderCount > 0 && check.moves.isEmpty
      && !check.spines.contains { $0.placement == .otherShelf }
  }

  /// "your DVD shelf" — without doubling a name that already says shelf.
  static func shelfPhrase(_ name: String) -> String {
    name.trimmingCharacters(in: .whitespaces).lowercased().hasSuffix("shelf")
      ? "your \(name)" : "your \(name) shelf"
  }
}
