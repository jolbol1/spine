import SwiftUI

/// Grid view: adaptive poster columns (three on an iPhone in portrait), the
/// chosen poster info pinned to each cover, and the sorted-by metric under it.
struct CollectionGridLayout<Header: View>: View {
  let films: [Film]
  let query: CollectionQuery
  @ViewBuilder var header: () -> Header

  @Environment(\.horizontalSizeClass) private var sizeClass

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 18) {
        header()
        if films.isEmpty {
          CollectionNoMatches()
        } else {
          LazyVGrid(columns: columns, alignment: .leading, spacing: 20) {
            ForEach(films) { film in
              NavigationLink(value: Route.film(id: film.id)) {
                CollectionGridCard(
                  film: film, overlays: query.activeOverlays, subtext: query.subtext(for: film))
              }
              .buttonStyle(.plain)
              .modifier(CollectionFilmActions(film: film))
            }
          }
        }
      }
      .padding(.horizontal, 16)
      .padding(.top, 4)
      .padding(.bottom, 24)
    }
    .scrollDismissesKeyboard(.immediately)
    .spineScreenBackground()
  }

  private var columns: [GridItem] {
    [GridItem(.adaptive(minimum: sizeClass == .regular ? 140 : 104), spacing: 12, alignment: .top)]
  }
}

/// List view: a row per film with the chosen poster info as values.
struct CollectionListLayout<Header: View>: View {
  let films: [Film]
  let query: CollectionQuery
  @ViewBuilder var header: () -> Header

  var body: some View {
    List {
      // The header is the section's header, not a row: a lone row gets the
      // section's rounded corners, which clip whatever sits in them.
      Section {
        if films.isEmpty {
          CollectionNoMatches()
            .listRowBackground(Color.clear)
            .listRowSeparator(.hidden)
        } else {
          ForEach(films) { film in
            NavigationLink(value: Route.film(id: film.id)) {
              CollectionFilmRow(
                film: film, columns: query.activeOverlays, subtext: query.subtext(for: film))
            }
            .listRowBackground(Color.spineCard)
            .modifier(CollectionFilmActions(film: film))
          }
        }
      } header: {
        header()
          .textCase(nil)
          .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 14, trailing: 0))
      }
    }
    .listStyle(.insetGrouped)
    .scrollDismissesKeyboard(.immediately)
    .spineScreenBackground()
  }
}

/// A poster in the grid. The sorted-by metric gets a line of its own under
/// the card's year and format: three columns on a phone leave no room for
/// it beside them.
private struct CollectionGridCard: View {
  let film: Film
  let overlays: [CollectionOverlay]
  let subtext: String?

  var body: some View {
    VStack(alignment: .leading, spacing: 3) {
      FilmCard(film: film) {
        ForEach(overlays) { overlay in
          CollectionOverlayChips(overlay: overlay, film: film)
        }
      }
      if let subtext {
        Text(subtext)
          .font(.caption.weight(.medium).monospacedDigit())
          .foregroundStyle(.spineForeground)
          .lineLimit(1)
          .padding(.horizontal, 2)
      }
    }
    .accessibilityElement(children: .combine)
  }
}

/// "No matches" under the header, so the controls that caused it stay in
/// reach.
private struct CollectionNoMatches: View {
  var body: some View {
    ContentUnavailableView(
      "No matches", systemImage: "line.3.horizontal.decrease",
      description: Text("Nothing in your collection matches this filter."))
    .padding(.top, 24)
  }
}

/// A film in list view: cover, "Title (year)", "director · edition" plus the
/// sorted-by metric, the format badge and HDR, then the chosen poster info.
struct CollectionFilmRow: View {
  let film: Film
  let columns: [CollectionOverlay]
  let subtext: String?

  var body: some View {
    HStack(spacing: 12) {
      PosterFrame(url: film.coverURL, title: film.title, cornerRadius: 4, maxPixelSize: 160)
        .frame(width: 44)

      VStack(alignment: .leading, spacing: 3) {
        titleLine
        byline
        HStack(spacing: 6) {
          FormatBadge(format: film.format)
          if let hdr = film.hdr, !hdr.isEmpty {
            Text(hdr)
              .font(.caption2)
              .foregroundStyle(.spineMutedForeground)
          }
        }
        .padding(.top, 1)
        if !columnValues.isEmpty {
          Text(columnValues.joined(separator: "  ·  "))
            .font(.caption.monospacedDigit())
            .foregroundStyle(.spineForeground)
            .lineLimit(2)
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)

      if film.isWatched {
        WatchedBadge()
      }
    }
    .padding(.vertical, 2)
    .accessibilityElement(children: .combine)
  }

  private var titleLine: some View {
    let year = film.year.map { Text(" (\(String($0)))").foregroundStyle(.spineMutedForeground) }
    return Text("\(Text(film.title).fontWeight(.medium))\(year ?? Text(verbatim: ""))")
      .font(.subheadline)
      .foregroundStyle(.spineForeground)
      .lineLimit(1)
  }

  /// Director and edition, then the sorted-by metric — which never gives
  /// way: a long byline truncates first.
  @ViewBuilder private var byline: some View {
    let base = [film.director, film.edition]
      .compactMap { $0?.isEmpty == false ? $0 : nil }
      .joined(separator: " · ")
    if !base.isEmpty || subtext != nil {
      HStack(spacing: 0) {
        if !base.isEmpty {
          Text(base)
            .foregroundStyle(.spineMutedForeground)
            .lineLimit(1)
        }
        if let subtext {
          Text("\(base.isEmpty ? "" : " · ")\(subtext)")
            .fontWeight(.medium)
            .monospacedDigit()
            .foregroundStyle(.spineForeground)
            .lineLimit(1)
            .layoutPriority(1)
        }
      }
      .font(.caption)
    }
  }

  private var columnValues: [String] {
    columns.compactMap { $0.listText(for: film) }
  }
}

/// One poster-info value as glass chips on a cover.
private struct CollectionOverlayChips: View {
  let overlay: CollectionOverlay
  let film: Film

  var body: some View {
    switch overlay {
    case .letterboxd:
      // The web tints the star Letterboxd green.
      if let rating = film.letterboxdRating {
        CollectionPosterTextChip(
          text: Text("\(Text("★").foregroundStyle(.lbGreen)) \(CollectionFormat.number(rating))"))
      }
    case .publisher:
      // Publisher names run long; truncate rather than spill off the cover.
      if let label = overlay.text(for: film) {
        CollectionPosterTextChip(text: Text(label))
      }
    default:
      ForEach(overlay.chips(for: film), id: \.self) { chip in
        PosterChip(text: chip)
      }
    }
  }
}

/// `PosterChip`'s look for rich or long text: styled runs, and truncation
/// to the cover's width.
private struct CollectionPosterTextChip: View {
  let text: Text

  var body: some View {
    text
      .font(.system(size: 10, weight: .bold).monospacedDigit())
      .foregroundStyle(.spineForeground)
      .lineLimit(1)
      .padding(.horizontal, 5)
      .padding(.vertical, 2)
      .glassEffect(.regular, in: .rect(cornerRadius: 4))
  }
}

/// A film's quick actions — long-press menu, and in list view swipes: mark
/// watched or unwatched, go back to following the Letterboxd sync, and
/// delete after a confirmation anchored to the film.
struct CollectionFilmActions: ViewModifier {
  let film: Film

  @Environment(Library.self) private var library
  @Environment(Toasts.self) private var toasts
  @State private var confirmingDelete = false

  func body(content: Content) -> some View {
    content
      .contextMenu {
        watchedButton
        if film.watchedOverride != nil {
          Button("Follow sync", systemImage: "arrow.counterclockwise") { setWatched(nil) }
        }
        Divider()
        deleteButton
      }
      .swipeActions(edge: .leading) {
        watchedButton.tint(.lbGreen)
      }
      .swipeActions(edge: .trailing, allowsFullSwipe: false) {
        deleteButton
      }
      .confirmationDialog(
        "Delete “\(film.title)”?", isPresented: $confirmingDelete, titleVisibility: .visible
      ) {
        Button("Delete", role: .destructive, action: delete)
      } message: {
        Text("This removes the title from your collection permanently.")
      }
  }

  private var watchedButton: some View {
    Button(
      film.isWatched ? "Mark unwatched" : "Mark watched",
      systemImage: film.isWatched ? "eye.slash" : "eye"
    ) {
      setWatched(!film.isWatched)
    }
  }

  private var deleteButton: some View {
    Button("Delete", systemImage: "trash", role: .destructive) { confirmingDelete = true }
  }

  /// true/false pins the watched state; nil follows the Letterboxd sync.
  private func setWatched(_ watched: Bool?) {
    Task {
      do {
        try await library.setWatched(id: film.id, watched)
      } catch {
        toasts.error("Could not update watched state")
      }
    }
  }

  private func delete() {
    Task {
      do {
        try await library.deleteFilm(id: film.id)
        toasts.success("Removed from collection")
      } catch {
        toasts.error("Could not delete")
      }
    }
  }
}
