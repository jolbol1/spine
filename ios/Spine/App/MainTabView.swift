import SwiftUI

/// The five sections of the web's nav, as a Liquid Glass tab bar. Each tab
/// owns its `NavigationStack`, bound to the shared `Router`.
struct MainTabView: View {
  @Environment(Library.self) private var library
  @Environment(Toasts.self) private var toasts
  @State private var router = Router()

  var body: some View {
    @Bindable var router = router
    TabView(selection: $router.tab) {
      Tab("Collection", systemImage: "square.grid.2x2.fill", value: AppTab.collection) {
        CollectionView(userID: library.userID)
      }
      Tab("Shelves", systemImage: "books.vertical.fill", value: AppTab.shelves) {
        ShelvesView()
      }
      Tab("Wishlist", systemImage: "heart.fill", value: AppTab.wishlist) {
        WishlistView()
      }
      Tab("Stats", systemImage: "chart.bar.xaxis", value: AppTab.stats) {
        StatsView()
      }
      Tab("Oracle", systemImage: "sparkles", value: AppTab.oracle) {
        OracleView()
      }
    }
    .tabBarMinimizeBehavior(.onScrollDown)
    .sheet(item: $router.sheet) { sheet in
      switch sheet {
      case .addFilm(let scan, let prefill, let staysOnAdd):
        AddFilmView(startScanning: scan, prefill: prefill) { film in
          router.sheet = nil
          guard !staysOnAdd else { return }
          router.showFilm(id: film.id)
        }
      case .settings:
        SettingsView()
      }
    }
    // Outermost, so the sheets see it too.
    .environment(router)
    .task {
      #if DEBUG
        DebugLaunch.apply(to: router)
      #endif
      await library.bootstrap()
      if let matched = await library.autoSyncLetterboxdIfStale(), matched > 0 {
        toasts.success(
          "Letterboxd sync — \(Formatters.count(matched, "title")) newly marked watched")
      }
    }
  }
}
