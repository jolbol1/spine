import SwiftUI

/// Search Blu-ray.com for a release and pick its cover — the web's
/// `CoverSearchDialog`. Opens already searching for the title and year.
struct FilmCoverSearchSheet: View {
  let defaultQuery: String
  let onPick: (BlurayResult) -> Void

  @Environment(Library.self) private var library
  @Environment(\.dismiss) private var dismiss
  @State private var query: String
  @State private var results: [BlurayResult]?
  @State private var failure: String?
  @State private var searching = false
  @State private var searchID = 0

  init(defaultQuery: String, onPick: @escaping (BlurayResult) -> Void) {
    self.defaultQuery = defaultQuery
    self.onPick = onPick
    _query = State(initialValue: defaultQuery)
  }

  var body: some View {
    NavigationStack {
      content
        .navigationTitle("Search Blu-ray.com")
        .navigationBarTitleDisplayMode(.inline)
        .searchable(
          text: $query, placement: .navigationBarDrawer(displayMode: .always),
          prompt: "Title or barcode…")
        .onSubmit(of: .search, runSearch)
        .toolbar {
          ToolbarItem(placement: .cancellationAction) {
            Button("Cancel", role: .cancel) { dismiss() }
          }
        }
        .spineScreenBackground()
    }
    .task {
      if !defaultQuery.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { runSearch() }
    }
  }

  @ViewBuilder
  private var content: some View {
    if let results, !results.isEmpty {
      ScrollView {
        LazyVGrid(
          columns: [GridItem(.adaptive(minimum: 100, maximum: 150), spacing: 12, alignment: .top)],
          spacing: 16
        ) {
          ForEach(results, id: \.url) { result in
            Button {
              onPick(result)
              dismiss()
            } label: {
              FilmCoverSearchCell(result: result)
            }
            .buttonStyle(.plain)
          }
        }
        .padding(16)
        .opacity(searching ? 0.5 : 1)
      }
    } else if searching {
      ProgressView()
        .controlSize(.large)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    } else if let failure {
      ContentUnavailableView {
        Label("Search failed", systemImage: "wifi.exclamationmark")
      } description: {
        Text(failure)
      } actions: {
        Button("Try again", action: runSearch).buttonStyle(.glass)
      }
    } else if results != nil {
      ContentUnavailableView {
        Label("No releases found", systemImage: "opticaldisc")
      } description: {
        Text("Try a different title or the barcode.")
      }
    } else {
      ContentUnavailableView {
        Label("Find a cover", systemImage: "photo.on.rectangle.angled")
      } description: {
        Text("Search Blu-ray.com by title or barcode, then pick a release.")
      }
    }
  }

  private func runSearch() {
    let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !q.isEmpty else { return }
    searchID += 1
    let id = searchID
    searching = true
    failure = nil
    Task {
      do {
        let found = try await library.api.searchBluray(q)
        guard id == searchID else { return }
        results = found
      } catch {
        guard id == searchID else { return }
        failure = error.userMessage
      }
      if id == searchID { searching = false }
    }
  }
}

/// A release in the cover grid: the cover with its country flag, then the
/// release's title.
private struct FilmCoverSearchCell: View {
  let result: BlurayResult

  var body: some View {
    VStack(alignment: .leading, spacing: 5) {
      PosterFrame(url: URL(string: result.coverUrl), title: result.title, maxPixelSize: 400)
        .overlay(alignment: .topTrailing) {
          if let flag = result.countryFlag.flatMap(URL.init(string:)) {
            RemoteImage(url: flag, maxPixelSize: 60, contentMode: .fit) { Color.clear }
              .frame(width: 18, height: 12)
              .clipShape(.rect(cornerRadius: 2))
              .padding(5)
          }
        }
      Text(result.title)
        .font(.caption)
        .foregroundStyle(.spineForeground)
        .lineLimit(2)
        .multilineTextAlignment(.leading)
    }
    .contentShape(.rect)
    .accessibilityElement(children: .combine)
    .accessibilityAddTraits(.isButton)
  }
}
