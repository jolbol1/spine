import SwiftUI

/// The Collection tab: every disc on the shelf as a poster grid or a list,
/// with search, media type, A–Z, filters, sorts, poster info, and saved
/// views — the web's collection page (src/routes/_app/index.tsx).
///
/// The browse state is a `CollectionQuery`, kept in the web's URL-param form
/// so saved views move freely between the web and the app. It persists
/// across launches, as the web keeps it in the URL.
struct CollectionView: View {
  @Environment(Library.self) private var library
  @Environment(Router.self) private var router
  @Environment(Toasts.self) private var toasts
  @Environment(\.horizontalSizeClass) private var sizeClass

  @State private var query: CollectionQuery
  /// The search field exactly as typed; the query holds it trimmed.
  @State private var searchText: String
  /// The last search sent to the query, to tell our own echo from a real
  /// external change (a view being applied).
  @State private var lastSentSearch: String
  @State private var didCheckDefaultView = false

  @State private var showingFilters = false
  @State private var showingSaveView = false
  @State private var showingManageViews = false

  private let userID: String

  /// `userID` scopes the remembered browse state to the signed-in account.
  init(userID: String) {
    self.userID = userID
    let restored = CollectionQuery(params: CollectionBrowseStorage.load(for: userID))
    _query = State(initialValue: restored)
    _searchText = State(initialValue: restored.search)
    _lastSentSearch = State(initialValue: restored.search)
  }

  var body: some View {
    NavigationStack(path: router.path(for: .collection)) {
      content
        .navigationTitle("Collection")
        .navigationSubtitle(subtitle)
        .toolbar { toolbar }
        .routeDestinations()
    }
    .sheet(isPresented: $showingFilters) {
      CollectionFilterSheet(query: $query, films: library.films)
    }
    .sheet(isPresented: $showingSaveView) {
      CollectionSaveViewSheet(params: currentParams, activeView: activeView)
    }
    .sheet(isPresented: $showingManageViews) {
      CollectionManageViewsSheet(activeName: activeView?.name) { view in
        apply(view)
      }
    }
    .onChange(of: query) { _, query in
      CollectionBrowseStorage.save(query.params, for: userID)
    }
    .onChange(of: searchText) { _, text in
      lastSentSearch = text.trimmingCharacters(in: .whitespacesAndNewlines)
      query.setSearch(text)
    }
    .onChange(of: query.search) { _, search in
      // Our own trimmed echo leaves the field as typed; a restored view
      // replaces it.
      guard search != lastSentSearch else { return }
      lastSentSearch = search
      searchText = search
    }
    .onChange(of: library.hasFetchedSettings, initial: true) {
      applyDefaultViewIfNeeded()
    }
  }

  // MARK: Content

  @ViewBuilder private var content: some View {
    if !library.hasLoadedFilms {
      if let error = library.loadError {
        LoadFailedView(message: error) { await library.refreshAll() }
      } else {
        LoadingView()
      }
    } else if library.films.isEmpty {
      emptyShelf
    } else {
      browser
    }
  }

  private var browser: some View {
    let films = library.films
    let visible = query.visible(films)
    return Group {
      switch query.layout {
      case .grid:
        CollectionGridLayout(films: visible, query: query) {
          header(films: films, matchCount: visible.count)
        }
      case .list:
        CollectionListLayout(films: visible, query: query) {
          header(films: films, matchCount: visible.count)
        }
      }
    }
    .searchable(
      text: $searchText, placement: .navigationBarDrawer(displayMode: .always),
      prompt: "Search title, director, spine…")
    .refreshable { await refresh() }
  }

  private func header(films: [Film], matchCount: Int) -> some View {
    CollectionBrowseHeader(
      query: $query, films: films, matchCount: matchCount, showsControls: !controlsInToolbar
    ) {
      if !controlsInToolbar {
        GlassEffectContainer(spacing: 8) {
          HStack(spacing: 8) {
            viewsMenu(titled: true)
            CollectionSortMenu(query: $query, titled: true)
            CollectionFiltersButton(activeCount: query.activeFilterCount) {
              showingFilters = true
            }
            CollectionDisplayMenu(query: $query, titled: true)
          }
          .buttonStyle(.glass)
          .lineLimit(1)
          .fixedSize()
        }
      }
    }
  }

  private func viewsMenu(titled: Bool) -> some View {
    CollectionViewsMenu(
      views: savedViews,
      activeView: activeView,
      onApply: apply,
      onSave: { showingSaveView = true },
      onManage: { showingManageViews = true },
      titled: titled)
  }

  private var emptyShelf: some View {
    ContentUnavailableView {
      Label("Your shelf is empty", systemImage: "opticaldisc")
    } description: {
      Text("Add your first disc to start cataloguing your collection.")
    } actions: {
      Button {
        router.sheet = .addFilm(scan: false)
      } label: {
        Text("Add a film").foregroundStyle(.onAccent)
      }
      .buttonStyle(.glassProminent)
      Button("Scan a barcode") { router.sheet = .addFilm(scan: true) }
        .buttonStyle(.glass)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(Color.spineBackground.ignoresSafeArea())
  }

  /// "30 titles · 11 watched" — the compact title's subtitle.
  private var subtitle: String {
    let films = library.films
    guard library.hasLoadedFilms, !films.isEmpty else { return "" }
    return "\(Formatters.count(films.count, "title")) · \(films.count(where: \.isWatched)) watched"
  }

  /// Under the large title: the counts with "watched" in green, and — while
  /// the Views menu is an icon in the toolbar — the saved view in use (the
  /// web names it on its Views button, as the iPad's in-content one does).
  private var largeSubtitle: some View {
    let films = library.films
    let watched = Text("\(films.count(where: \.isWatched)) watched").foregroundStyle(.lbGreen)
    return HStack(spacing: 6) {
      Text("\(Formatters.count(films.count, "title")) · \(watched)")
        .monospacedDigit()
        .layoutPriority(1)
      if controlsInToolbar, let activeView {
        Text("\(Image(systemName: "bookmark.fill")) \(activeView.name)")
          .foregroundStyle(.lbBlue)
          .lineLimit(1)
          .accessibilityLabel("Saved view: \(activeView.name)")
      }
    }
    .font(.footnote)
    .foregroundStyle(.spineMutedForeground)
    .lineLimit(1)
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  // MARK: Toolbar

  /// On iPad the tab bar sits between the toolbar's sides, leaving too
  /// little room: the browse controls move into the content there.
  private var controlsInToolbar: Bool { sizeClass != .regular }

  @ToolbarContentBuilder private var toolbar: some ToolbarContent {
    if library.hasLoadedFilms && !library.films.isEmpty {
      ToolbarItem(placement: .largeSubtitle) { largeSubtitle }
      if controlsInToolbar {
        ToolbarItem(placement: .topBarLeading) { viewsMenu(titled: false) }
        ToolbarItemGroup(placement: .topBarTrailing) {
          CollectionSortMenu(query: $query)
          Button("Filters", systemImage: "line.3.horizontal.decrease") {
            showingFilters = true
          }
          .badge(query.activeFilterCount)
          .accessibilityValue(
            query.activeFilterCount > 0 ? "\(query.activeFilterCount) active" : "")
          CollectionDisplayMenu(query: $query)
        }
        ToolbarSpacer(.fixed, placement: .topBarTrailing)
      }
    }
    ToolbarItem(placement: .topBarTrailing) {
      Menu("Add", systemImage: "plus") {
        Button("Add film", systemImage: "plus") { router.sheet = .addFilm(scan: false) }
        Button("Scan barcode", systemImage: "barcode.viewfinder") {
          router.sheet = .addFilm(scan: true)
        }
      }
    }
    AccountButton()
  }

  // MARK: Saved views

  private var savedViews: [SavedView] { library.settings?.savedViews ?? [] }

  /// The current state, as a saved view stores it.
  private var currentParams: [String: String] { CollectionQuery.sanitize(query.params) }

  private var activeView: SavedView? {
    CollectionSavedViews.active(in: savedViews, matching: currentParams)
  }

  private func apply(_ view: SavedView) {
    query = CollectionQuery(params: view.params)
  }

  /// A fresh start with no browse state loads the default view — once, when
  /// settings first arrive from the server (the cached copy can predate a
  /// default set on the web).
  private func applyDefaultViewIfNeeded() {
    guard !didCheckDefaultView, library.hasFetchedSettings else { return }
    let settings = library.settings
    didCheckDefaultView = true
    if let view = settings?.savedViews?.first(where: { $0.isDefault == true }),
      query.params.isEmpty
    {
      apply(view)
    }
  }

  // MARK: Actions

  private func refresh() async {
    await library.refreshAll()
    if let error = library.loadError { toasts.error(error) }
  }
}

/// The browse state kept between launches — the app's equivalent of the
/// web's URL. Kept per account, so signing in as someone else doesn't
/// inherit the last account's filters.
enum CollectionBrowseStorage {
  private static func key(for userID: String) -> String { "collection.browseParams.\(userID)" }

  static func load(for userID: String) -> [String: String] {
    guard let json = UserDefaults.standard.string(forKey: key(for: userID)),
      let params = try? JSONDecoder().decode([String: String].self, from: Data(json.utf8))
    else { return [:] }
    return params
  }

  static func save(_ params: [String: String], for userID: String) {
    let encoder = JSONEncoder()
    encoder.outputFormatting = .sortedKeys
    guard let data = try? encoder.encode(params) else { return }
    UserDefaults.standard.set(String(decoding: data, as: UTF8.self), forKey: key(for: userID))
  }
}
