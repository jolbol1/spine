import SwiftUI

/// Add a film — the web's /add page as a sheet. One field searches
/// Blu-ray.com or imports a pasted product link, the scanner looks a disc up
/// by its barcode, and the form below takes the details (filled by any
/// import, or by hand).
struct AddFilmView: View {
  let startScanning: Bool
  let onAdded: (Film) -> Void

  @Environment(Library.self) private var library
  @Environment(Toasts.self) private var toasts
  @Environment(\.dismiss) private var dismiss
  @State private var model = FilmAddModel()
  @State private var scannerOpen: Bool
  @State private var creating = false
  @State private var showsAllResults = false
  @FocusState private var focus: FilmFormFocus?

  init(startScanning: Bool, onAdded: @escaping (Film) -> Void) {
    self.startScanning = startScanning
    self.onAdded = onAdded
    _scannerOpen = State(initialValue: startScanning)
  }

  var body: some View {
    NavigationStack {
      ScrollViewReader { proxy in
        Form {
          importSection
          if model.showsWebMatches { webMatchesSection }
          if model.showsResults { resultsSection }
          FilmFormSections(values: $model.values, focus: $focus, anchorID: Self.formTop)
        }
        .onChange(of: model.importCount) {
          if focus == .importQuery { focus = nil }
          withAnimation { proxy.scrollTo(Self.formTop, anchor: .top) }
        }
      }
      .filmFormChrome(focus: $focus)
      .animation(.default, value: model.showsResults)
      .animation(.default, value: model.showsWebMatches)
      .animation(.default, value: model.scanStage == nil)
      .navigationTitle("Add a film")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel", role: .cancel) { dismiss() }
        }
      }
      .safeAreaBar(edge: .bottom) {
        FilmFormSubmitBar(label: "Add to collection", pending: creating, action: add)
      }
      .task(id: model.query) { await model.autocomplete(api: library.api) }
      .sheet(isPresented: $scannerOpen) {
        FilmBarcodeScanSheet { code in
          model.scanned(code, api: library.api, toasts: toasts)
        }
      }
      .sensoryFeedback(.success, trigger: model.scanCount)
    }
    .interactiveDismissDisabled(creating || model.values != .empty)
  }

  private static let formTop = "film-form-top"

  // MARK: Import field

  private var importSection: some View {
    Section {
      HStack(spacing: 10) {
        Image(systemName: model.isURL ? "link" : "magnifyingglass")
          .foregroundStyle(.spineMutedForeground)
          .frame(width: 20)
          .accessibilityHidden(true)
        TextField(
          "Search Blu-ray.com or paste a product link", text: $model.query,
          prompt: Text("Search Blu-ray.com, or paste a link"))
          .textInputAutocapitalization(.never)
          .autocorrectionDisabled()
          .submitLabel(model.isURL ? .go : .search)
          .focused($focus, equals: .importQuery)
          .onSubmit { model.importTypedLink(api: library.api, toasts: toasts) }
        // The scan chain shows its own progress row below.
        if model.searching || model.importing {
          ProgressView().controlSize(.small)
        } else if !model.query.isEmpty {
          Button {
            model.query = ""
          } label: {
            Image(systemName: "xmark.circle.fill")
              .foregroundStyle(.spineMutedForeground)
          }
          .buttonStyle(.plain)
          .accessibilityLabel("Clear")
        }
      }

      if model.isURL {
        Button {
          model.importTypedLink(api: library.api, toasts: toasts)
        } label: {
          Label("Import from link", systemImage: "square.and.arrow.down")
        }
        .disabled(model.importing)
      }

      Button {
        scannerOpen = true
      } label: {
        Label("Scan a barcode", systemImage: "barcode.viewfinder")
      }

      if let stage = model.scanStage {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
          ProgressView().controlSize(.small)
          VStack(alignment: .leading, spacing: 2) {
            Text(stage)
              .font(.subheadline)
              .foregroundStyle(.spineForeground)
            if let code = model.scannedCode {
              Text(code)
                .font(.caption.monospacedDigit())
                .foregroundStyle(.spineMutedForeground)
            }
          }
        }
        .accessibilityElement(children: .combine)
      }
    } footer: {
      Text(
        "Search Blu-ray.com, paste a product link (Blu-ray.com, CEX, HMV, Arrow…), or scan the disc's barcode to import the full details — or fill the form in by hand."
      )
    }
    .listRowBackground(Color.spineCard)
  }

  // MARK: Matches

  private var webMatchesSection: some View {
    Section("Best matches from a web search — check the year") {
      ForEach(model.webMatches, id: \.self) { match in
        Button {
          model.pick(match)
        } label: {
          FilmImportOptionRow(
            imageURL: match.posterUrl.flatMap(URL.init(string:)),
            title: match.title,
            subtitle: [match.year.map(String.init), match.mediaType == "tv" ? "TV" : "Movie"]
              .compactMap { $0 }.joined(separator: " · "))
        }
      }
    }
    .listRowBackground(Color.spineCard)
  }

  private var resultsSection: some View {
    let shown = showsAllResults ? model.results : Array(model.results.prefix(Self.collapsedResults))
    return Section("Blu-ray.com") {
      ForEach(shown, id: \.url) { result in
        Button {
          model.pick(result, api: library.api, toasts: toasts)
        } label: {
          FilmImportOptionRow(
            imageURL: URL(string: result.coverUrl.replacingOccurrences(of: "_front.jpg", with: "_small.jpg")),
            title: result.title,
            subtitle: [result.year.map(String.init), result.releaseDate]
              .compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · "),
            flagURL: result.countryFlag.flatMap(URL.init(string:)),
            loading: model.importingURL == result.url)
        }
        .disabled(model.importing)
      }
      if model.results.count > shown.count {
        Button("Show all \(model.results.count) releases") {
          withAnimation { showsAllResults = true }
        }
      }
    }
    .listRowBackground(Color.spineCard)
    .onChange(of: model.results) { showsAllResults = false }
  }

  /// Long result lists start collapsed, so the form stays within reach.
  private static let collapsedResults = 6

  // MARK: Submit

  private func add() {
    guard model.values.hasTitle else {
      toasts.error("A title is required")
      focus = .title
      return
    }
    focus = nil
    creating = true
    let input = model.values.input
    Task {
      defer { creating = false }
      do {
        let film = try await library.createFilm(input)
        toasts.success("“\(film.title)” added to your collection")
        onAdded(film)
      } catch {
        toasts.filmFailure(
          error, fallback: "Could not add the film — check the fields", showServerMessage: false)
      }
    }
  }
}

/// One match in the import list: a small cover, the title, and a detail
/// line, with the release's country flag for Blu-ray.com hits.
private struct FilmImportOptionRow: View {
  let imageURL: URL?
  let title: String
  let subtitle: String
  var flagURL: URL? = nil
  var loading = false

  var body: some View {
    HStack(spacing: 12) {
      RemoteImage(url: imageURL, maxPixelSize: 160)
        .frame(width: 40, height: 56)
        .clipShape(.rect(cornerRadius: 3))
      VStack(alignment: .leading, spacing: 3) {
        Text(title)
          .font(.subheadline)
          .foregroundStyle(.spineForeground)
          .lineLimit(2)
        if !subtitle.isEmpty {
          Text(subtitle)
            .font(.caption)
            .foregroundStyle(.spineMutedForeground)
        }
      }
      Spacer(minLength: 8)
      if loading {
        ProgressView().controlSize(.small)
      } else if let flagURL {
        RemoteImage(url: flagURL, maxPixelSize: 60, contentMode: .fit) { Color.clear }
          .frame(width: 18, height: 12)
          .accessibilityHidden(true)
      }
    }
    .contentShape(.rect)
    .accessibilityElement(children: .combine)
  }
}
