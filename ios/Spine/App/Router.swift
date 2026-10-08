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
}

/// Full-screen tasks presented over the tabs.
enum AppSheet: Identifiable, Hashable {
  /// Add a film; `scan` opens the barcode scanner straight away.
  case addFilm(scan: Bool)
  case settings

  var id: String {
    switch self {
    case .addFilm(let scan): "add-\(scan)"
    case .settings: "settings"
    }
  }
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
}

extension View {
  /// Registers the screens every tab can push: film detail and person.
  func routeDestinations() -> some View {
    navigationDestination(for: Route.self) { route in
      switch route {
      case .film(let id): FilmDetailView(filmID: id)
      case .person(let name): PersonView(name: name)
      }
    }
  }
}
