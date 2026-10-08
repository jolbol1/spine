import SwiftUI

/// The Shelves tab — a digital twin of the physical wall. Every film lands
/// on exactly one shelf (the first whose rules it matches, top to bottom),
/// shown as covers standing on a ledge in display order.
struct ShelvesView: View {
  @Environment(Library.self) private var library
  @Environment(Toasts.self) private var toasts

  var body: some View {
    ShelvesScreen(library: library, toasts: toasts)
      .id(ObjectIdentifier(library))
  }
}

/// What the builder sheet is open on.
enum ShelfBuilderTarget: Identifiable, Hashable {
  case new
  case edit(String)

  var id: String {
    switch self {
    case .new: "new"
    case .edit(let id): id
    }
  }
}

private struct ShelvesScreen: View {
  @Environment(Library.self) private var library
  @Environment(Router.self) private var router
  @Environment(\.horizontalSizeClass) private var sizeClass

  @State private var store: ShelvesStore
  @State private var builder: ShelfBuilderTarget?
  @State private var arranging: Shelf?
  @State private var organizing = false
  @State private var showGhosts = false
  @State private var pendingTemplate: ShelfTemplate?
  @State private var deleting: Shelf?

  init(library: Library, toasts: Toasts) {
    _store = State(initialValue: ShelvesStore(library: library, toasts: toasts))
  }

  private var hasLoaded: Bool { library.hasLoadedFilms && library.hasLoadedSettings }

  var body: some View {
    NavigationStack(path: router.path(for: .shelves)) {
      content
        .navigationTitle("Shelves")
        .toolbar { toolbar }
        .routeDestinations()
        .spineScreenBackground()
    }
    .sheet(item: $builder) { target in
      ShelfBuilderView(editing: shelf(for: target))
    }
    .sheet(item: $arranging) { shelf in
      ShelfArrangeView(shelf: shelf, ordered: assignment.films(on: shelf))
    }
    .sheet(isPresented: $organizing) {
      ShelfOrganizerView()
    }
    .confirmationDialog(
      "Replace your shelves?",
      isPresented: Binding(
        get: { pendingTemplate != nil }, set: { if !$0 { pendingTemplate = nil } }),
      titleVisibility: .visible,
      presenting: pendingTemplate
    ) { template in
      Button("Replace Shelves", role: .destructive) { store.apply(template) }
    } message: { _ in
      Text(
        "This replaces your current shelves with the template's — your rules, pins, and hand-arranged orders go with them."
      )
    }
    .confirmationDialog(
      deleting.map { "Delete “\($0.name)”?" } ?? "",
      isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
      titleVisibility: .visible,
      presenting: deleting
    ) { shelf in
      Button("Delete Shelf", role: .destructive) { store.delete(id: shelf.id) }
    } message: { _ in
      Text("Its films move to the next shelf they match.")
    }
    .environment(store)
  }

  // MARK: Content

  @ViewBuilder private var content: some View {
    if !hasLoaded {
      if let error = library.loadError {
        LoadFailedView(message: error) { await library.refreshAll() }
      } else {
        LoadingView()
      }
    } else if store.shelves.isEmpty {
      ShelvesEmptyState(
        onTemplate: applyTemplate,
        onNewShelf: { builder = .new })
    } else {
      wall
    }
  }

  private var assignment: ShelfEngine.Assignment {
    ShelfEngine.assign(library.films, to: store.shelves)
  }

  private var metrics: ShelfMetrics {
    ShelfMetrics(coverWidth: sizeClass == .regular ? 116 : 88)
  }

  private var wall: some View {
    let shelves = store.shelves
    let assignment = assignment
    let ghosts =
      showGhosts
      ? ShelfEngine.assignWishlist(library.wishlist, to: shelves) : [:]
    let placedGhosts = ghosts.values.reduce(0) { $0 + $1.count }
    let unplacedGhosts = showGhosts ? library.wishlist.count - placedGhosts : 0
    let gutter: CGFloat = sizeClass == .regular ? 24 : 16

    return ScrollView {
      LazyVStack(alignment: .leading, spacing: 30) {
        ShelvesSummary(
          shelfCount: shelves.count,
          unshelved: assignment.unshelved.count,
          unplacedGhosts: unplacedGhosts
        )
        .padding(.horizontal, gutter)

        ForEach(Array(shelves.enumerated()), id: \.element.id) { index, shelf in
          ShelfSectionView(
            shelf: shelf,
            index: index,
            shelves: shelves,
            ordered: assignment.films(on: shelf),
            ghosts: ghosts[shelf.id] ?? [],
            metrics: metrics,
            gutter: gutter,
            onEdit: { builder = .edit(shelf.id) },
            onArrange: { arranging = shelf },
            onDelete: { deleting = shelf })
        }

        if !assignment.unshelved.isEmpty {
          ShelfUnshelvedTray(
            films: assignment.unshelved, shelves: shelves, metrics: metrics, gutter: gutter)
        }
      }
      .padding(.top, 4)
      .padding(.bottom, 32)
    }
    .refreshable { await library.refreshAll() }
  }

  // MARK: Toolbar

  @ToolbarContentBuilder private var toolbar: some ToolbarContent {
    if hasLoaded && !store.shelves.isEmpty {
      ToolbarItem(placement: .topBarTrailing) {
        Menu {
          Toggle(isOn: $showGhosts) {
            Label("Wishlist Ghosts", systemImage: "heart")
            Text("Show where wishlist items would shelve")
          }
          Menu {
            templateButtons
          } label: {
            Label("Templates", systemImage: "sparkles")
          }
          Button {
            store.markArranged(store.shelves.map(\.id))
          } label: {
            Label("Mark All Arranged", systemImage: "checkmark.circle")
            Text("Clears the NEW flags")
          }
          Divider()
          Button("Edit Shelves", systemImage: "list.bullet") { organizing = true }
        } label: {
          Label("Shelf options", systemImage: "ellipsis")
        }
      }
    }
    if hasLoaded {
      ToolbarItem(placement: .topBarTrailing) {
        Button("Check a shelf photo", systemImage: "text.viewfinder") {
          router.open(.shelfCheck(shelfID: nil), in: .shelves)
        }
      }
      ToolbarItem(placement: .topBarTrailing) {
        Button("New Shelf", systemImage: "plus") { builder = .new }
      }
    }
    AccountButton()
  }

  @ViewBuilder private var templateButtons: some View {
    ForEach(ShelfTemplate.allCases) { template in
      Button {
        applyTemplate(template)
      } label: {
        Text(template.label)
        Text(template.summary)
      }
    }
  }

  // MARK: Actions

  private func shelf(for target: ShelfBuilderTarget) -> Shelf? {
    guard case .edit(let id) = target else { return nil }
    return store.shelves.first { $0.id == id }
  }

  /// Replacing an existing layout is destructive — confirm first.
  private func applyTemplate(_ template: ShelfTemplate) {
    if store.shelves.isEmpty {
      store.apply(template)
    } else {
      pendingTemplate = template
    }
  }
}

/// The line under the title: how precedence works, plus anything that
/// needs attention (unshelved films, ghosts with nowhere to go).
private struct ShelvesSummary: View {
  let shelfCount: Int
  let unshelved: Int
  let unplacedGhosts: Int

  var body: some View {
    text
      .font(.subheadline)
      .foregroundStyle(.spineMutedForeground)
      .fixedSize(horizontal: false, vertical: true)
  }

  private var text: Text {
    var text = Text(
      verbatim:
        "\(Formatters.count(shelfCount, "shelf", plural: "shelves")) · films land on the first shelf they match, top to bottom"
    )
    if unshelved > 0 {
      let count = Text(verbatim: "\(unshelved) unshelved").foregroundStyle(.lbOrange)
      text = Text("\(text) · \(count)")
    }
    if unplacedGhosts > 0 {
      let ghosts = Formatters.count(unplacedGhosts, "wishlist item")
      text = Text(
        "\(text) · \(ghosts) can't be placed — a ghost needs a format and a shelf whose rules use only format, type, or decade"
      )
    }
    return text
  }
}

/// Fixed geometry for a shelf row, so the ledge can sit exactly under the
/// covers while they scroll past it.
struct ShelfMetrics {
  var coverWidth: CGFloat
  var coverHeight: CGFloat { (coverWidth * 1.5).rounded() }
  /// Gap above the covers inside the cubby.
  var top: CGFloat = 16
  /// The ledge's thickness.
  var ledge: CGFloat = 12
  var spacing: CGFloat = 10
}
