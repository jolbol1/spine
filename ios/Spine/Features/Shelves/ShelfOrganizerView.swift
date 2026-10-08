import SwiftUI

/// Every shelf in precedence order: drag to reorder, swipe to delete, tap
/// to edit (rename, rules…). Changes save as they happen.
struct ShelfOrganizerView: View {
  @Environment(ShelvesStore.self) private var store
  @Environment(Library.self) private var library
  @Environment(\.dismiss) private var dismiss
  @State private var builder: ShelfBuilderTarget?

  var body: some View {
    let shelves = store.shelves
    let assignment = ShelfEngine.assign(library.films, to: shelves)

    NavigationStack {
      List {
        Section {
          ForEach(shelves) { shelf in
            Button {
              builder = .edit(shelf.id)
            } label: {
              ShelfOrganizerRow(shelf: shelf, count: assignment.films(on: shelf).count)
            }
          }
          .onMove { store.move(fromOffsets: $0, toOffset: $1) }
          .onDelete { offsets in
            for id in offsets.map({ shelves[$0].id }) { store.delete(id: id) }
          }
          .listRowBackground(Color.spineCard)
        } footer: {
          Text("Films land on the first shelf they match, top to bottom — drag a shelf higher to let it claim its films first.")
        }

        Section {
          Button("New Shelf", systemImage: "plus") { builder = .new }
        }
        .listRowBackground(Color.spineCard)
      }
      .overlay {
        if shelves.isEmpty {
          ContentUnavailableView(
            "No shelves yet", systemImage: "books.vertical",
            description: Text("Add a shelf to start mirroring your wall."))
        }
      }
      .spineScreenBackground()
      .navigationTitle("Edit Shelves")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .topBarLeading) { EditButton() }
        ToolbarItem(placement: .confirmationAction) {
          Button("Done", role: .confirm) { dismiss() }
        }
      }
      .sheet(item: $builder) { target in
        if case .edit(let id) = target {
          ShelfBuilderView(editing: shelves.first { $0.id == id })
        } else {
          ShelfBuilderView(editing: nil)
        }
      }
    }
  }
}

private struct ShelfOrganizerRow: View {
  let shelf: Shelf
  let count: Int

  private var isOver: Bool { shelf.capacity.map { count > $0 } ?? false }

  var body: some View {
    HStack(spacing: 12) {
      VStack(alignment: .leading, spacing: 3) {
        Text(shelf.name)
          .font(.body.weight(.semibold))
          .foregroundStyle(.spineForeground)
        Text(Self.ruleSummary(shelf))
          .font(.caption)
          .foregroundStyle(.spineMutedForeground)
          .lineLimit(2)
      }
      Spacer(minLength: 8)
      Text(shelf.capacity.map { "\(count) / \($0)" } ?? "\(count)")
        .font(.subheadline.monospacedDigit())
        .foregroundStyle(isOver ? Color.spineDestructive : Color.spineMutedForeground)
    }
    .contentShape(.rect)
    .accessibilityElement(children: .combine)
  }

  /// "Format: 4K UHD · Type: Movie", or what a rule-less shelf does.
  static func ruleSummary(_ shelf: Shelf) -> String {
    let rules = shelf.rules.filter { !$0.values.isEmpty }
    guard !rules.isEmpty else { return "Catches everything not claimed above" }
    return rules.map { rule in
      "\(ShelfEngine.label(for: rule.field)): \(rule.values.joined(separator: ", "))"
    }
    .joined(separator: " · ")
  }
}
