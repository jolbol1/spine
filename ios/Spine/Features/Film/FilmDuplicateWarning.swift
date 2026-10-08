import SwiftUI

/// The film form's warning that the disc looks catalogued already: one row
/// per match, most certain first, each opening that film. Adding is still
/// allowed — a second copy is a real thing to own.
struct FilmDuplicateSection: View {
  let matches: [CollectionMatch.Match]
  let onOpen: (Film) -> Void

  var body: some View {
    Section {
      ForEach(matches, id: \.film.id) { match in
        Button {
          onOpen(match.film)
        } label: {
          FilmDuplicateRow(match: match)
        }
        .accessibilityHint("Opens the copy in your collection")
      }
    } header: {
      // The same disc warns; another edition of a film you own just informs.
      if CollectionMatch.isSameDisc(matches) {
        Label("Already in your collection", systemImage: "exclamationmark.triangle.fill")
          .foregroundStyle(.lbOrange)
      } else {
        Label("You have this film", systemImage: "info.circle.fill")
          .foregroundStyle(.lbBlue)
      }
    }
    .listRowBackground(Color.spineCard)
  }
}

private struct FilmDuplicateRow: View {
  let match: CollectionMatch.Match

  var body: some View {
    HStack(spacing: 12) {
      PosterFrame(url: match.film.coverURL, title: match.film.title, cornerRadius: 3, maxPixelSize: 120)
        .frame(width: 34)
      VStack(alignment: .leading, spacing: 3) {
        Text(match.film.catalogueLine)
          .font(.subheadline.weight(.semibold))
          .foregroundStyle(.spineForeground)
          .lineLimit(2)
        Text(reason)
          .font(.caption)
          .foregroundStyle(match.reason == .otherFormat ? Color.spineMutedForeground : .lbOrange)
          .fixedSize(horizontal: false, vertical: true)
      }
      Spacer(minLength: 8)
      Image(systemName: "chevron.forward")
        .font(.caption.weight(.semibold))
        .foregroundStyle(.spineMutedForeground)
        .accessibilityHidden(true)
    }
    .contentShape(.rect)
    .accessibilityElement(children: .combine)
  }

  private var reason: String {
    switch match.reason {
    case .barcode: "This exact disc is already catalogued"
    case .sameFormat: "Already in your collection"
    case .otherFormat: "You have it on \(match.film.format) — this would be another copy"
    }
  }
}

extension Film {
  /// "Dune (2021) · 4K UHD" — how a catalogued copy is named in warnings.
  var catalogueLine: String {
    "\(title)\(year.map { " (\($0))" } ?? "") · \(format)"
  }
}

extension FilmFormValues {
  /// The form as the disc to check for duplicates.
  var duplicateCandidate: CollectionMatch.Candidate {
    .init(
      title: title, year: FilmFormValues.parseInt(year), format: format,
      barcode: barcode.isEmpty ? nil : barcode)
  }
}
