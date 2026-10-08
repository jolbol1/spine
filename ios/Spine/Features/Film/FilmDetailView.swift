import SwiftUI

/// One film — the web's /films/$filmId page. Pushed onto a tab's stack;
/// reads the film from the library, so edits anywhere show at once.
struct FilmDetailView: View {
  let filmID: String

  @Environment(Library.self) private var library
  /// The film as it was when Delete was confirmed, so the screen doesn't
  /// flash "no longer in your collection" while it pops.
  @State private var removed: Film?

  var body: some View {
    if let film = library.film(id: filmID) ?? removed {
      FilmDetailContent(film: film, removed: $removed)
    } else if !library.hasLoadedFilms {
      if let error = library.loadError {
        LoadFailedView(message: error) { await library.refreshAll() }
      } else {
        LoadingView()
      }
    } else {
      ContentUnavailableView {
        Label("Not in your collection", systemImage: "opticaldisc")
      } description: {
        Text("This film is no longer in your collection.")
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .background(Color.spineBackground.ignoresSafeArea())
    }
  }
}

private struct FilmDetailContent: View {
  let film: Film
  @Binding var removed: Film?

  @Environment(Library.self) private var library
  @Environment(Toasts.self) private var toasts
  @Environment(\.dismiss) private var dismiss
  @Environment(\.horizontalSizeClass) private var sizeClass

  @State private var editing = false
  @State private var scanningCover = false
  @State private var confirmingDelete = false
  @State private var deleting = false
  @State private var refreshingRT = false
  @State private var rematching = false
  @State private var savingWatched = false
  @State private var showsNavTitle = false

  private var wide: Bool { sizeClass == .regular }
  private var posterWidth: CGFloat { wide ? 260 : 200 }

  var body: some View {
    ScrollView {
      VStack(spacing: 0) {
        FilmDetailHero(
          film: film, wide: wide, posterWidth: posterWidth,
          refreshingRT: refreshingRT, refreshRT: refreshRT)

        VStack(alignment: .leading, spacing: 28) {
          if film.tmdbId == nil {
            FilmTmdbMissingCard(pending: rematching, retry: rematch)
              .padding(.horizontal, 16)
          }
          FilmWatchedCard(film: film, pending: savingWatched, setWatched: setWatched)
            .padding(.horizontal, 16)
          FilmDiscDetails(film: film)
            .padding(.horizontal, 16)
          if let cast = film.tmdbCast, !cast.isEmpty {
            FilmCastScroller(cast: cast)
          }
          if let review = film.letterboxdReview, !review.isEmpty {
            FilmTextBlock(title: "My review", text: review, quoted: true)
              .padding(.horizontal, 16)
          }
          if let notes = film.notes, !notes.isEmpty {
            FilmTextBlock(title: "Notes", text: notes, quoted: false)
              .padding(.horizontal, 16)
          }
        }
        .frame(maxWidth: 760)
        .padding(.top, 8)
        .padding(.bottom, 32)
      }
      .frame(maxWidth: .infinity)
    }
    .background(Color.spineBackground.ignoresSafeArea())
    .onScrollGeometryChange(for: Bool.self) { geometry in
      geometry.contentOffset.y + geometry.contentInsets.top > posterWidth * 1.5 + 60
    } action: { _, past in
      showsNavTitle = past
    }
    .refreshable { await reload() }
    .navigationTitle(film.title)
    .navigationBarTitleDisplayMode(.inline)
    .toolbar { toolbar }
    .sheet(isPresented: $editing) {
      FilmEditSheet(film: film)
    }
    .filmCoverScanner(isPresented: $scanningCover, format: film.format, onCover: saveCover)
    .animation(.default, value: film.tmdbId == nil)
  }

  // MARK: Toolbar

  @ToolbarContentBuilder
  private var toolbar: some ToolbarContent {
    ToolbarItem(placement: .principal) {
      Text(film.title)
        .font(.headline)
        .lineLimit(1)
        .opacity(showsNavTitle ? 1 : 0)
        .animation(.easeOut(duration: 0.2), value: showsNavTitle)
        .accessibilityHidden(!showsNavTitle)
    }
    ToolbarItem(placement: .topBarTrailing) {
      Button("Edit") { editing = true }
        .disabled(deleting)
    }
    ToolbarSpacer(.fixed, placement: .topBarTrailing)
    ToolbarItemGroup(placement: .topBarTrailing) {
      if let url = film.tmdbURL ?? film.imdbURL {
        ShareLink(item: url, subject: Text(film.title)) {
          Label("Share", systemImage: "square.and.arrow.up")
        }
      }
      Button("Scan new cover", systemImage: "doc.viewfinder") { scanningCover = true }
        .disabled(deleting)
      Button(role: .destructive) {
        confirmingDelete = true
      } label: {
        Label("Delete film", systemImage: "trash")
      }
      .tint(.spineDestructive)
      .disabled(deleting)
      .confirmationDialog(
        "Delete “\(film.title)”?", isPresented: $confirmingDelete, titleVisibility: .visible
      ) {
        Button("Delete", role: .destructive, action: delete)
        Button("Cancel", role: .cancel) {}
      } message: {
        Text("This removes the title from your collection permanently.")
      }
    }
  }

  // MARK: Actions

  private func reload() async {
    do {
      try await library.reloadFilm(id: film.id)
    } catch {
      toasts.error(error)
    }
  }

  /// A scanned cover replaces the current one straight away, the rest of
  /// the film as it is.
  private func saveCover(_ url: String) async throws {
    var values = FilmFormValues(film: library.film(id: film.id) ?? film)
    values.coverUrl = url
    try await library.updateFilm(id: film.id, values.input)
    toasts.success("Cover updated")
  }

  private func setWatched(_ watched: Bool?) {
    guard !savingWatched else { return }
    savingWatched = true
    Task {
      defer { savingWatched = false }
      do {
        try await library.setWatched(id: film.id, watched)
      } catch {
        toasts.filmFailure(error, fallback: "Could not update watched state", showServerMessage: false)
      }
    }
  }

  private func refreshRT() {
    guard !refreshingRT else { return }
    refreshingRT = true
    Task {
      defer { refreshingRT = false }
      do {
        switch try await library.api.refreshRtScores(id: film.id) {
        case .failure(let message):
          toasts.error(message)
        case .success(let scores):
          try? await library.reloadFilm(id: film.id)
          let critics = scores.criticsScore.map(String.init) ?? "–"
          let audience = scores.audienceScore.map(String.init) ?? "–"
          toasts.success("Rotten Tomatoes — critics \(critics)%, audience \(audience)%")
        }
      } catch {
        toasts.filmFailure(error, fallback: "Could not reach Rotten Tomatoes", showServerMessage: false)
      }
    }
  }

  private func rematch() {
    guard !rematching else { return }
    rematching = true
    Task {
      defer { rematching = false }
      do {
        switch try await library.api.rematchTmdb(id: film.id) {
        case .failure(let message):
          toasts.error(message)
        case .success(let match):
          try? await library.reloadFilm(id: film.id)
          toasts.success("Matched on TMDB — \(match.castCount) cast members added")
        }
      } catch {
        toasts.filmFailure(error, fallback: "TMDB lookup failed", showServerMessage: false)
      }
    }
  }

  private func delete() {
    guard !deleting else { return }
    deleting = true
    removed = film
    Task {
      do {
        try await library.deleteFilm(id: film.id)
        toasts.success("Removed from collection")
        dismiss()
      } catch {
        deleting = false
        removed = nil
        toasts.filmFailure(error, fallback: "Could not delete", showServerMessage: false)
      }
    }
  }
}
