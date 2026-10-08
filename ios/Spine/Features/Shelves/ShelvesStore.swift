import Foundation
import Observation
import SwiftUI

/// The shelves layout plus every edit the page and builder make to it. The
/// server replaces the whole ordered list on each save, so every action
/// computes the next list and hands it to `update`.
///
/// Saves are optimistic, as on the web — reorders and pins show at once —
/// and run one at a time so the server sees them in order. A failed save
/// rolls back to the server's copy with the web's toast.
@Observable
final class ShelvesStore {
  private let library: Library
  private let toasts: Toasts

  /// The layout as last edited, until the server confirms it.
  private var pending: [Shelf]?
  private var generation = 0
  private var queue: Task<Void, Never>?

  init(library: Library, toasts: Toasts) {
    self.library = library
    self.toasts = toasts
  }

  var shelves: [Shelf] { pending ?? library.settings?.shelves ?? [] }

  func update(_ next: [Shelf]) {
    pending = next
    generation += 1
    let current = generation
    let previous = queue
    queue = Task {
      await previous?.value
      do {
        try await library.saveShelves(next)
      } catch {
        if !(error is CancellationError), (error as? APIError) != .unauthorized {
          toasts.error("Could not save shelves")
        }
        if current == generation {
          pending = nil
          try? await library.refreshSettings()
        }
        return
      }
      if current == generation { pending = nil }
    }
  }

  // MARK: Shelf-level actions

  /// Adds a new shelf at the bottom, or replaces the one with its id.
  func save(_ shelf: Shelf) {
    let exists = shelves.contains { $0.id == shelf.id }
    var next = exists ? shelves.map { $0.id == shelf.id ? shelf : $0 } : shelves + [shelf]
    // A film pinned here in the builder leaves any other shelf's pins, as
    // "Pin to" does — a film is pinned to one shelf at a time.
    let pins = Set(shelf.pinned ?? [])
    if !pins.isEmpty {
      next = next.map { other in
        guard other.id != shelf.id, let pinned = other.pinned else { return other }
        var other = other
        other.pinned = pinned.filter { !pins.contains($0) }
        return other
      }
    }
    update(next)
    toasts.success("Shelf “\(shelf.name)” saved")
  }

  func delete(id: String) {
    let shelf = shelves.first { $0.id == id }
    update(shelves.filter { $0.id != id })
    if let shelf { toasts.success("Shelf “\(shelf.name)” deleted") }
  }

  /// Swap with the neighbour above (-1) or below (1); no-op past the ends.
  func move(id: String, by delta: Int) {
    guard let index = shelves.firstIndex(where: { $0.id == id }) else { return }
    let target = index + delta
    guard shelves.indices.contains(target) else { return }
    var next = shelves
    next.swapAt(index, target)
    update(next)
  }

  /// Drag-to-reorder from a `List`.
  func move(fromOffsets source: IndexSet, toOffset destination: Int) {
    var next = shelves
    next.move(fromOffsets: source, toOffset: destination)
    guard next.map(\.id) != shelves.map(\.id) else { return }
    update(next)
  }

  func markArranged(_ ids: [String]) {
    let now = JSONCoding.isoString(Date())
    update(
      shelves.map { shelf in
        guard ids.contains(shelf.id) else { return shelf }
        var shelf = shelf
        shelf.arrangedAt = now
        return shelf
      })
    toasts.success(ids.count == 1 ? "Shelf marked arranged" : "All shelves marked arranged")
  }

  func apply(_ template: ShelfTemplate) {
    update(ShelfEngine.templateShelves(template, films: library.films))
    toasts.success("Shelves created — tweak the rules to taste")
  }

  // MARK: Film-level actions

  func pin(filmID: String, to shelfID: String) {
    update(
      shelves.map { shelf in
        var shelf = shelf
        if shelf.id == shelfID {
          shelf.pinned = (shelf.pinned ?? []).filter { $0 != filmID } + [filmID]
          shelf.excluded = shelf.excluded?.filter { $0 != filmID }
        } else {
          shelf.pinned = shelf.pinned?.filter { $0 != filmID }
        }
        return shelf
      })
  }

  func unpin(filmID: String) {
    update(
      shelves.map { shelf in
        var shelf = shelf
        shelf.pinned = shelf.pinned?.filter { $0 != filmID }
        return shelf
      })
  }

  /// "Remove from this shelf" — the film falls through to the next match.
  func exclude(filmID: String, from shelfID: String) {
    update(
      shelves.map { shelf in
        guard shelf.id == shelfID else { return shelf }
        var shelf = shelf
        shelf.excluded = (shelf.excluded ?? []).filter { $0 != filmID } + [filmID]
        shelf.pinned = shelf.pinned?.filter { $0 != filmID }
        return shelf
      })
  }

  /// Hand-arranged order: the whole shelf's ids, as the user stood them.
  func setManualOrder(_ ids: [String], on shelfID: String) {
    update(
      shelves.map { shelf in
        guard shelf.id == shelfID else { return shelf }
        var shelf = shelf
        shelf.manualOrder = ids
        return shelf
      })
  }

  func clearManualOrder(on shelfID: String) {
    update(
      shelves.map { shelf in
        guard shelf.id == shelfID else { return shelf }
        var shelf = shelf
        shelf.manualOrder = nil
        return shelf
      })
  }
}
