import SwiftUI

/// The sort picker: every sort, the active one checked with its direction
/// ("A to Z", "Highest first") beneath. Picking the active sort flips the
/// direction.
struct CollectionSortMenu: View {
  @Binding var query: CollectionQuery
  /// In-content (iPad): the label names the sort and its direction.
  var titled = false

  /// Plain orders first, then the metric sorts, each in the web's order.
  private static let sections: [[CollectionSort]] = [
    CollectionSort.allCases.filter { !$0.isMetric },
    CollectionSort.allCases.filter(\.isMetric),
  ]

  var body: some View {
    Menu {
      ForEach(Self.sections, id: \.self) { section in
        Section {
          ForEach(section, id: \.self) { sort in
            option(sort)
          }
        }
      }
    } label: {
      if titled {
        Label(
          query.sort.label,
          systemImage: query.effectiveDirection == .asc ? "arrow.up" : "arrow.down")
      } else {
        Label("Sort", systemImage: "arrow.up.arrow.down")
      }
    }
    .accessibilityLabel("Sort")
    .accessibilityValue(
      "\(query.sort.label), \(query.sort.directionLabel(query.effectiveDirection))")
  }

  /// The active sort is checked, with its direction underneath; picking it
  /// again flips that.
  private func option(_ sort: CollectionSort) -> some View {
    let active = query.sort == sort
    return Toggle(
      isOn: Binding(get: { active }, set: { _ in query.selectSort(sort) })
    ) {
      Text(sort.label)
      if active {
        Text(sort.directionLabel(query.effectiveDirection))
      }
    }
  }
}

extension CollectionSort {
  /// How a direction reads for this sort: "A to Z", "Newest first"…
  func directionLabel(_ direction: SortDirection) -> String {
    let asc = direction == .asc
    switch self {
    case .title, .publisher: return asc ? "A to Z" : "Z to A"
    case .year, .added: return asc ? "Oldest first" : "Newest first"
    case .format: return asc ? "4K UHD first" : "DVD first"
    case .runtime: return asc ? "Shortest first" : "Longest first"
    default: return asc ? "Lowest first" : "Highest first"
    }
  }
}

/// Grid or list, and which poster info (list: columns) to show.
struct CollectionDisplayMenu: View {
  @Binding var query: CollectionQuery
  /// In-content (iPad): the label says "Poster info" / "Columns".
  var titled = false

  var body: some View {
    Menu {
      Picker(
        "Layout",
        selection: Binding(get: { query.layout }, set: { query.setLayout($0) })
      ) {
        Label("Grid", systemImage: "square.grid.2x2").tag(CollectionLayout.grid)
        Label("List", systemImage: "list.bullet").tag(CollectionLayout.list)
      }
      .pickerStyle(.palette)

      Section(query.layout == .list ? "Columns" : "Poster info") {
        ForEach(CollectionOverlay.allCases) { overlay in
          Toggle(
            overlay.label,
            isOn: Binding(
              get: { query.overlayKeys.contains(overlay) },
              set: { _ in query.toggleOverlay(overlay) }))
        }
      }
      // Pick several without reopening the menu, as on the web.
      .menuActionDismissBehavior(.disabled)
    } label: {
      Label(
        titled ? (query.layout == .list ? "Columns" : "Poster info") : "View options",
        systemImage: query.layout == .list ? "list.bullet" : "square.grid.2x2")
    }
    .accessibilityLabel("View options")
  }
}

/// The Filters button for in-content use (iPad), with the web's green count
/// pill — toolbar copies use the system badge instead.
struct CollectionFiltersButton: View {
  let activeCount: Int
  var action: () -> Void

  var body: some View {
    Button(action: action) {
      HStack(spacing: 6) {
        Label("Filters", systemImage: "line.3.horizontal.decrease")
        if activeCount > 0 {
          Text("\(activeCount)")
            .font(.caption.weight(.bold).monospacedDigit())
            .foregroundStyle(.onAccent)
            .padding(.horizontal, 6)
            .background(.lbGreen, in: .capsule)
        }
      }
    }
    .accessibilityValue(activeCount > 0 ? "\(activeCount) active" : "")
  }
}
