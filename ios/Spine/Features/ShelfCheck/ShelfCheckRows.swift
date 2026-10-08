import SwiftUI

// The shelf check's rows, top to bottom.

// MARK: - Photos

/// The photos so far, each with how its reading went. Long-press one to
/// read it again or remove it.
struct ShelfCheckPhotoStrip: View {
  let photos: [ShelfCheckModel.Photo]
  let preparing: Int
  let retry: (ShelfCheckModel.Photo.ID) -> Void
  let remove: (ShelfCheckModel.Photo.ID) -> Void

  var body: some View {
    ScrollView(.horizontal) {
      HStack(spacing: 10) {
        ForEach(Array(photos.enumerated()), id: \.element.id) { index, photo in
          ShelfCheckThumbnail(photo: photo, number: index + 1)
            .contextMenu {
              if case .failed = photo.phase {
                Button("Read Again", systemImage: "arrow.clockwise") { retry(photo.id) }
              }
              Button("Remove Photo", systemImage: "trash", role: .destructive) { remove(photo.id) }
            }
        }
        ForEach(0..<preparing, id: \.self) { _ in
          RoundedRectangle(cornerRadius: 8)
            .fill(Color.spineSecondary)
            .frame(width: ShelfCheckThumbnail.size.width, height: ShelfCheckThumbnail.size.height)
            .overlay { ProgressView() }
            .accessibilityLabel("Preparing photo")
        }
      }
      .padding(.vertical, 2)
    }
    .scrollIndicators(.hidden)
    .animation(.default, value: photos.map(\.id))
    .animation(.default, value: preparing)
  }
}

private struct ShelfCheckThumbnail: View {
  let photo: ShelfCheckModel.Photo
  let number: Int

  static let size = CGSize(width: 66, height: 88)

  var body: some View {
    Image(uiImage: photo.upload.thumbnail)
      .resizable()
      .scaledToFill()
      .frame(width: Self.size.width, height: Self.size.height)
      .clipShape(.rect(cornerRadius: 8))
      .overlay {
        RoundedRectangle(cornerRadius: 8)
          .strokeBorder(border, lineWidth: border == .spineBorder ? 1 : 2)
      }
      .overlay {
        if case .reading = photo.phase {
          ZStack {
            RoundedRectangle(cornerRadius: 8).fill(.black.opacity(0.45))
            ProgressView().tint(.white)
          }
        }
      }
      .overlay(alignment: .bottomTrailing) {
        badge.padding(4)
      }
      .accessibilityElement(children: .ignore)
      .accessibilityLabel("Photo \(number), \(status)")
  }

  private var border: Color {
    switch photo.phase {
    case .reading: .lbGreen
    case .failed: .spineDestructive
    default: .spineBorder
    }
  }

  @ViewBuilder private var badge: some View {
    switch photo.phase {
    case .waiting:
      ShelfCheckBadge(systemImage: "clock", tint: .spineForeground)
    case .reading:
      EmptyView()
    case .read:
      ShelfCheckBadge(systemImage: "checkmark", text: "\(photo.spines.count)", tint: .lbGreen)
    case .failed:
      ShelfCheckBadge(systemImage: "exclamationmark", tint: .spineDestructive)
    }
  }

  private var status: String {
    switch photo.phase {
    case .waiting: "waiting to be read"
    case .reading: "reading"
    case .read: "read, \(Formatters.count(photo.spines.count, "spine"))"
    case .failed(let message): "couldn’t be read: \(message)"
    }
  }
}

private struct ShelfCheckBadge: View {
  let systemImage: String
  var text: String? = nil
  let tint: Color

  var body: some View {
    HStack(spacing: 2) {
      Image(systemName: systemImage)
      if let text { Text(text).monospacedDigit() }
    }
    .font(.system(size: 10, weight: .bold))
    .foregroundStyle(tint)
    .padding(.horizontal, 5)
    .padding(.vertical, 3)
    .glassEffect(.regular, in: .capsule)
  }
}

/// "Reading photo 2 of 3…" with the time it's taken so far.
struct ShelfCheckProgressRow: View {
  private let title: String
  private let since: Date?

  init(number: Int, total: Int, since: Date) {
    title = "Reading photo \(number) of \(total)…"
    self.since = since
  }

  init(preparing: Int) {
    title = preparing == 1 ? "Preparing the photo…" : "Preparing \(preparing) photos…"
    since = nil
  }

  var body: some View {
    HStack(spacing: 12) {
      ProgressView()
      VStack(alignment: .leading, spacing: 2) {
        Text(title)
          .font(.subheadline.weight(.semibold))
          .foregroundStyle(.spineForeground)
        if let since {
          Text("\(Text(since, style: .timer)) · each photo takes 20–90 seconds")
            .font(.caption.monospacedDigit())
            .foregroundStyle(.spineMutedForeground)
        }
      }
    }
    .padding(.vertical, 2)
    .accessibilityElement(children: .combine)
  }
}

/// A photo that couldn't be read, with the server's reason.
struct ShelfCheckFailureRow: View {
  let number: Int
  let message: String
  let retry: () -> Void

  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: 12) {
      Image(systemName: "exclamationmark.triangle.fill")
        .foregroundStyle(.spineDestructive)
        .accessibilityHidden(true)
      VStack(alignment: .leading, spacing: 3) {
        Text("Photo \(number)")
          .font(.subheadline.weight(.semibold))
          .foregroundStyle(.spineForeground)
        Text(message)
          .font(.caption)
          .foregroundStyle(.spineMutedForeground)
          .fixedSize(horizontal: false, vertical: true)
      }
      Spacer(minLength: 8)
      Button("Try Again", action: retry)
        .buttonStyle(.glass)
        .controlSize(.small)
    }
    .padding(.vertical, 2)
  }
}

// MARK: - Spines

struct ShelfCheckSectionHeader: View {
  let title: String
  let count: Int

  var body: some View {
    HStack {
      Text(title)
      Spacer()
      Text(count, format: .number).monospacedDigit()
    }
  }
}

/// A spine that isn't catalogued: what was read, and Add — or, once it's
/// been added, "Added ✓".
struct ShelfCheckMissingRow: View {
  let spine: ShelfSpine
  let added: Bool
  let add: () -> Void

  var body: some View {
    HStack(spacing: 12) {
      VStack(alignment: .leading, spacing: 5) {
        Text(spine.title)
          .font(.body.weight(.semibold))
          .foregroundStyle(.spineForeground)
        if spine.text.compare(spine.title, options: [.caseInsensitive, .diacriticInsensitive])
          != .orderedSame && !spine.text.isEmpty
        {
          Text("“\(spine.text)”")
            .font(.caption)
            .foregroundStyle(.spineMutedForeground)
            .lineLimit(2)
        }
        ShelfCheckChips(spine: spine)
      }
      Spacer(minLength: 8)
      if added {
        Text("Added \(Image(systemName: "checkmark"))")
          .font(.subheadline.weight(.semibold))
          .foregroundStyle(.lbGreen)
      } else {
        Button(action: add) {
          HStack(spacing: 4) {
            Image(systemName: "plus")
            Text("Add")
          }
          .font(.subheadline.weight(.semibold))
        }
        .buttonStyle(.glass)
        .accessibilityLabel("Add \(spine.title)")
        .accessibilityIdentifier("shelfcheck.add")
      }
    }
    .padding(.vertical, 3)
    .alignmentGuide(.listRowSeparatorLeading) { $0[.leading] }
  }
}

/// On the shelf in one format, catalogued in another.
struct ShelfCheckOtherFormatRow: View {
  let spine: ShelfSpine
  let film: ShelfSpine.MatchedFilm
  /// The catalogued copy as it is now, when it's still there.
  let current: Film?
  /// A copy in the spine's format has been added since.
  var added = false

  var body: some View {
    HStack(spacing: 12) {
      PosterFrame(
        url: current?.coverURL ?? film.coverURL, title: film.title, cornerRadius: 3,
        maxPixelSize: 120
      )
      .frame(width: 36)
      VStack(alignment: .leading, spacing: 4) {
        Text(spine.title)
          .font(.body.weight(.semibold))
          .foregroundStyle(.spineForeground)
        Text("You have it on \(current?.format ?? film.format)")
          .font(.subheadline)
          .foregroundStyle(.lbBlue)
        ShelfCheckChips(spine: spine)
      }
      if added {
        Spacer(minLength: 8)
        Text("Added \(Image(systemName: "checkmark"))")
          .font(.subheadline.weight(.semibold))
          .foregroundStyle(.lbGreen)
      }
    }
    .padding(.vertical, 2)
    .accessibilityElement(children: .combine)
  }
}

/// A spine that's catalogued.
struct ShelfCheckOwnedRow: View {
  let film: ShelfSpine.MatchedFilm
  let current: Film?

  var body: some View {
    HStack(spacing: 12) {
      PosterFrame(
        url: current?.coverURL ?? film.coverURL, title: film.title, cornerRadius: 3,
        maxPixelSize: 120
      )
      .frame(width: 30)
      VStack(alignment: .leading, spacing: 3) {
        Text("\(film.title)\(film.year.map { " (\($0))" } ?? "")")
          .font(.subheadline)
          .foregroundStyle(.spineForeground)
          .lineLimit(2)
        FormatBadge(format: current?.format ?? film.format)
      }
    }
    .accessibilityElement(children: .combine)
  }
}

/// What the spine shows beyond its title: year, format, label, spine
/// number — and a marker when it was hard to read.
private struct ShelfCheckChips: View {
  let spine: ShelfSpine

  var body: some View {
    FilmFlowLayout(spacing: 5, lineSpacing: 5) {
      if let year = spine.year {
        Tag(text: String(year)).monospacedDigit()
      }
      if let format = spine.format {
        FormatBadge(format: format, size: .regular)
      }
      if let label = spine.label, !label.isEmpty {
        Tag(text: label)
      }
      if let number = spine.spineNumber {
        Tag(text: "#\(number)", foreground: .lbBlue)
      }
      if spine.legibility != .clear {
        Tag(
          text: "Hard to read", fill: Color.lbOrange.opacity(0.16), foreground: .lbOrange,
          systemImage: "eye.trianglebadge.exclamationmark"
        )
        .accessibilityLabel(
          spine.legibility == .partial ? "Partly hard to read" : "Hard to read — a guess")
      }
    }
  }
}
