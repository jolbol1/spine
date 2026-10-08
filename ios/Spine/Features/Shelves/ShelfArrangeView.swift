import SwiftUI

/// Hand-arrange one shelf: drag the films into the order they stand on the
/// physical shelf. Saving stores the whole order as the shelf's manual
/// order, as the web's nudge buttons do.
struct ShelfArrangeView: View {
  let shelf: Shelf

  @Environment(ShelvesStore.self) private var store
  @Environment(\.dismiss) private var dismiss
  @State private var order: [Film]
  @State private var moved = false
  @State private var moveCount = 0

  init(shelf: Shelf, ordered: [Film]) {
    self.shelf = shelf
    _order = State(initialValue: ordered)
  }

  private var isHandArranged: Bool { shelf.manualOrder?.isEmpty == false }

  var body: some View {
    NavigationStack {
      List {
        Section {
          ForEach(Array(order.enumerated()), id: \.element.id) { index, film in
            ShelfArrangeRow(film: film, position: index + 1, shelf: shelf)
          }
          .onMove { source, destination in
            order.move(fromOffsets: source, toOffset: destination)
            moved = true
            moveCount += 1
          }
          .listRowBackground(Color.spineCard)
        } footer: {
          Text(footer)
        }

        if isHandArranged {
          Section {
            Button("Reset to Sorted Order", systemImage: "arrow.counterclockwise") {
              store.clearManualOrder(on: shelf.id)
              dismiss()
            }
          } footer: {
            Text("Drops the hand-arranged order; the shelf follows its sort again.")
          }
          .listRowBackground(Color.spineCard)
        }
      }
      .environment(\.editMode, .constant(.active))
      .spineScreenBackground()
      .navigationTitle("Arrange Shelf")
      .navigationSubtitle(shelf.name)
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel", role: .cancel) { dismiss() }
        }
        ToolbarItem(placement: .confirmationAction) {
          Button("Done", role: .confirm) {
            if moved { store.setManualOrder(order.map(\.id), on: shelf.id) }
            dismiss()
          }
        }
      }
      .sensoryFeedback(.selection, trigger: moveCount)
    }
    .interactiveDismissDisabled(moved)
  }

  private var footer: String {
    var text =
      shelf.isStacked
      ? "Drag films into the order they lie in the pile, top first."
      : "Drag films into the order they stand on the physical shelf."
    if let capacity = shelf.capacity, order.count > capacity {
      text += " Slots past \(capacity) are the suggested spill."
    }
    return text
  }
}

private struct ShelfArrangeRow: View {
  let film: Film
  let position: Int
  let shelf: Shelf

  private var isOver: Bool { shelf.capacity.map { position > $0 } ?? false }
  private var isNew: Bool { ShelfEngine.isNewSinceArranged(shelf, film) }

  var body: some View {
    HStack(spacing: 12) {
      Text("\(position)")
        .font(.subheadline.weight(.semibold).monospacedDigit())
        .foregroundStyle(isOver ? Color.spineDestructive : Color.spineMutedForeground)
        .frame(minWidth: 26, alignment: .trailing)
      PosterFrame(url: film.coverURL, title: "", cornerRadius: 3, maxPixelSize: 120)
        .frame(width: 30)
        .opacity(isOver ? 0.6 : 1)
      VStack(alignment: .leading, spacing: 2) {
        Text(film.title)
          .foregroundStyle(.spineForeground)
          .lineLimit(1)
        HStack(spacing: 6) {
          if let year = film.year { Text(String(year)) }
          FormatBadge(format: film.format)
          if let label = film.label { Text(label).lineLimit(1) }
        }
        .font(.caption)
        .foregroundStyle(.spineMutedForeground)
      }
      Spacer(minLength: 4)
      if isNew { ShelfNewBadge(text: "New") }
    }
    .accessibilityElement(children: .combine)
    .accessibilityValue(isOver ? "Slot \(position), past capacity" : "Slot \(position)")
  }
}
