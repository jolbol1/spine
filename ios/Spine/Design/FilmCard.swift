import SwiftUI

/// "4K UHD" / "Blu-ray" / "DVD" in the format's colour.
struct FormatBadge: View {
  let format: String
  var size: Size = .small

  enum Size { case small, regular }

  var body: some View {
    let colors = Color.formatBadge(format)
    Text(format.uppercased())
      .font(size == .small ? .system(size: 9, weight: .bold) : .caption.weight(.bold))
      .tracking(0.4)
      .foregroundStyle(colors.text)
      .padding(.horizontal, size == .small ? 4 : 7)
      .padding(.vertical, size == .small ? 1.5 : 3)
      .background(colors.fill, in: .rect(cornerRadius: size == .small ? 3 : 5))
      .fixedSize()
  }
}

/// A 2:3 cover, or the title set in caps when there's no artwork.
struct PosterFrame: View {
  let url: URL?
  let title: String
  var cornerRadius: CGFloat = 6
  /// Long-edge pixel budget — grids use the default, hero images more.
  var maxPixelSize: CGFloat = 500

  var body: some View {
    Color.spineSecondary
      .aspectRatio(2 / 3, contentMode: .fit)
      .overlay {
        RemoteImage(url: url, maxPixelSize: maxPixelSize) {
          ZStack {
            Color.spineSecondary
            // Shrinks rather than breaking words in list-row thumbnails.
            Text(title.uppercased())
              .font(.system(size: 11, weight: .semibold))
              .tracking(0.6)
              .multilineTextAlignment(.center)
              .foregroundStyle(.spineMutedForeground)
              .lineLimit(4)
              .minimumScaleFactor(0.4)
              .padding(6)
          }
        }
      }
      .clipShape(.rect(cornerRadius: cornerRadius))
      .overlay {
        RoundedRectangle(cornerRadius: cornerRadius)
          .strokeBorder(.spineBorder, lineWidth: 1)
      }
  }
}

/// A small value pinned over a poster — spine number, scores, ratings.
struct PosterChip: View {
  let text: String
  var tint: Color? = nil

  var body: some View {
    Text(text)
      .font(.system(size: 10, weight: .bold).monospacedDigit())
      .foregroundStyle(tint ?? .spineForeground)
      .padding(.horizontal, 5)
      .padding(.vertical, 2)
      .glassEffect(.regular, in: .rect(cornerRadius: 4))
      .fixedSize()
  }
}

/// The green eye for a watched film.
struct WatchedBadge: View {
  var size: CGFloat = 10

  var body: some View {
    Image(systemName: "eye.fill")
      .font(.system(size: size, weight: .bold))
      .foregroundStyle(.onAccent)
      .padding(size * 0.45)
      .background(.lbGreen, in: .circle)
      .accessibilityLabel("Watched")
  }
}

/// A film in a poster grid: cover with spine number, optional chips, and the
/// watched eye, then title, year, and format. Wrap it in a
/// `NavigationLink(value: Route.film(id:))`.
struct FilmCard<Overlay: View>: View {
  let film: Film
  /// A value shown at the end of the caption — e.g. the metric being sorted by.
  var subtext: String? = nil
  /// Extra chips pinned to the poster's top-right corner.
  @ViewBuilder var overlay: () -> Overlay

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      PosterFrame(url: film.coverURL, title: film.title)
        .overlay(alignment: .topLeading) {
          if let spine = film.spineNumber {
            PosterChip(text: "#\(spine)").padding(5)
          }
        }
        .overlay(alignment: .topTrailing) {
          VStack(alignment: .trailing, spacing: 3) { overlay() }.padding(5)
        }
        .overlay(alignment: .bottomTrailing) {
          if film.isWatched { WatchedBadge().padding(5) }
        }

      VStack(alignment: .leading, spacing: 3) {
        Text(film.title)
          .font(.subheadline.weight(.medium))
          .foregroundStyle(.spineForeground)
          .lineLimit(1)
        HStack(spacing: 5) {
          if let year = film.year {
            Text(String(year))
              .font(.caption)
              .foregroundStyle(.spineMutedForeground)
              .lineLimit(1)
              .fixedSize()
          }
          FormatBadge(format: film.format)
          if let subtext {
            Spacer(minLength: 2)
            Text(subtext)
              .font(.caption.weight(.medium).monospacedDigit())
              .foregroundStyle(.spineForeground)
              .lineLimit(1)
          }
        }
      }
      .padding(.horizontal, 2)
    }
    .contentShape(.rect)
    .accessibilityElement(children: .combine)
  }
}

extension FilmCard where Overlay == EmptyView {
  init(film: Film, subtext: String? = nil) {
    self.init(film: film, subtext: subtext) { EmptyView() }
  }
}
