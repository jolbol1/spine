import Observation
import SwiftUI

enum AppTab: String, Hashable, CaseIterable {
  case collection, shelves, wishlist, stats, oracle
}

/// A screen pushed onto a tab's navigation stack. Every tab's stack can show
/// either — apply `.routeDestinations()` inside each `NavigationStack`.
enum Route: Hashable {
  case film(id: String)
  /// A director or cast member, by name — everything of theirs on the shelf.
  case person(name: String)
  /// Photograph a shelf and see which discs aren't catalogued yet. With a
  /// shelf, check that shelf's order instead.
  case shelfCheck(shelfID: String?)
}

/// Full-screen tasks presented over the tabs.
enum AppSheet: Identifiable, Hashable {
  /// Add a film; `scan` opens the barcode scanner straight away. `prefill`
  /// starts the form from a known title, and `staysOnAdd` just closes the
  /// sheet after adding, leaving the user where they were, rather than
  /// opening the new film.
  case addFilm(scan: Bool, prefill: AddFilmPrefill? = nil, staysOnAdd: Bool = false)
  case settings

  var id: String {
    switch self {
    case .addFilm(let scan, let prefill, _): "add-\(scan)-\(prefill?.query ?? "")"
    case .settings: "settings"
    }
  }
}

/// A disc to add that's already partly known — e.g. a spine read off a
/// shelf photo.
struct AddFilmPrefill: Hashable {
  /// Seeds the import field, so the Blu-ray.com search runs straight away.
  var query: String
  var title: String
  var year: Int?
  /// "4K UHD" | "Blu-ray" | "DVD", when known.
  var format: String?
}

/// Tab selection, each tab's navigation path, and the presented sheet —
/// held centrally so any screen can send the user anywhere (e.g. a new film
/// opens in the Collection tab).
@Observable
final class Router {
  var tab: AppTab = .collection
  var sheet: AppSheet?
  private var paths: [AppTab: [Route]] = [:]

  /// Bind a tab's `NavigationStack(path:)` to this.
  func path(for tab: AppTab) -> Binding<[Route]> {
    Binding(
      get: { self.paths[tab] ?? [] },
      set: { self.paths[tab] = $0 }
    )
  }

  /// Push `route`, switching to `tab` first when given.
  func open(_ route: Route, in tab: AppTab? = nil) {
    if let tab { self.tab = tab }
    paths[self.tab, default: []].append(route)
  }

  func popToRoot(_ tab: AppTab) {
    paths[tab] = []
  }

  /// Close any sheet and open a film on its own in the Collection tab —
  /// after adding it, or to see the copy already catalogued.
  func showFilm(id: String) {
    sheet = nil
    popToRoot(.collection)
    open(.film(id: id), in: .collection)
  }
}

extension View {
  /// Registers the screens every tab can push: film detail, person, and
  /// the shelf check.
  func routeDestinations() -> some View {
    navigationDestination(for: Route.self) { route in
      switch route {
      case .film(let id): FilmDetailView(filmID: id)
      case .person(let name): PersonView(name: name)
      case .shelfCheck(let shelfID): ShelfCheckView(shelfID: shelfID)
      }
    }
  }
}
