import SwiftUI

// The pieces of the film page, top to bottom.

// MARK: - Hero

/// The poster over a blurred, darkened copy of itself that runs up behind
/// the navigation bar, then the title, directors, badges, and genres.
struct FilmDetailHero: View {
  let film: Film
  let wide: Bool
  let posterWidth: CGFloat
  let refreshingRT: Bool
  let refreshRT: () -> Void

  var body: some View {
    Group {
      if wide {
        HStack(alignment: .bottom, spacing: 28) {
          poster
          info(alignment: .leading)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        // Line up with the cards below, which sit 16pt inside a 760pt column.
        .padding(.horizontal, 16)
        .frame(maxWidth: 760)
      } else {
        VStack(spacing: 18) {
          poster
          info(alignment: .center)
        }
        .padding(.horizontal, 20)
      }
    }
    .padding(.top, 12)
    .padding(.bottom, 24)
    .frame(maxWidth: .infinity)
    .background {
      FilmHeroBackdrop(url: film.coverURL)
        // Run up under the navigation bar and the status bar.
        .padding(.top, -600)
    }
  }

  private var poster: some View {
    PosterFrame(url: film.coverURL, title: film.title, cornerRadius: 10, maxPixelSize: 900)
      .frame(width: posterWidth)
      .shadow(color: .black.opacity(0.55), radius: 22, y: 12)
      .accessibilityLabel("Cover of \(film.title)")
  }

  private func info(alignment: HorizontalAlignment) -> some View {
    let textAlignment: TextAlignment = alignment == .center ? .center : .leading
    return VStack(alignment: alignment, spacing: 12) {
      VStack(alignment: alignment, spacing: 4) {
        Text(film.title)
          .font(wide ? .largeTitle.bold() : .title.bold())
          .foregroundStyle(.spineForeground)
          .multilineTextAlignment(textAlignment)
          .accessibilityAddTraits(.isHeader)
        if let year = film.year {
          Text(String(year))
            .font(.title3)
            .foregroundStyle(.spineMutedForeground)
        }
      }
      if !film.directors.isEmpty {
        FilmDirectedBy(directors: film.directors, alignment: alignment)
      }
      FilmBadgeRow(film: film, alignment: alignment, refreshingRT: refreshingRT, refreshRT: refreshRT)
      if let genres = film.tmdbDetails?.genres, !genres.isEmpty {
        Text(genres.joined(separator: " · "))
          .font(.subheadline)
          .foregroundStyle(.spineMutedForeground)
          .multilineTextAlignment(textAlignment)
      }
    }
  }
}

/// The cover, heavily blurred and darkened, fading into the page.
private struct FilmHeroBackdrop: View {
  let url: URL?

  var body: some View {
    RemoteImage(url: url, maxPixelSize: 240) { Color.spineBackground }
      .blur(radius: 50, opaque: true)
      .overlay {
        LinearGradient(
          stops: [
            .init(color: Color.spineBackground.opacity(0.4), location: 0),
            .init(color: Color.spineBackground.opacity(0.62), location: 0.55),
            .init(color: Color.spineBackground, location: 1),
          ],
          startPoint: .top, endPoint: .bottom)
      }
      .clipped()
      .accessibilityHidden(true)
  }
}

/// "Directed by A, B" — each name opens that person.
private struct FilmDirectedBy: View {
  let directors: [String]
  let alignment: HorizontalAlignment

  var body: some View {
    FilmFlowLayout(alignment: alignment, spacing: 4, lineSpacing: 2) {
      Text("Directed by")
        .foregroundStyle(.spineMutedForeground)
      ForEach(Array(directors.enumerated()), id: \.offset) { index, name in
        NavigationLink(value: Route.person(name: name)) {
          Text(name + (index < directors.count - 1 ? "," : ""))
            .fontWeight(.semibold)
            .foregroundStyle(.spineForeground)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Directed by \(name)")
        .accessibilityHint("Shows everything of theirs in your collection")
      }
    }
    .font(.body)
  }
}

// MARK: - Badges

/// Format, HDR, spine number, watched state, and the Rotten Tomatoes scores
/// with their refresh button.
private struct FilmBadgeRow: View {
  let film: Film
  let alignment: HorizontalAlignment
  let refreshingRT: Bool
  let refreshRT: () -> Void

  var body: some View {
    let format = Color.formatBadge(film.format)
    FilmFlowLayout(alignment: alignment, spacing: 6, lineSpacing: 6) {
      FilmBadge(text: film.format, fill: format.fill, foreground: format.text)
      if let hdr = film.hdr {
        FilmBadge(text: hdr, fill: .spineSecondary, foreground: .spineForeground)
      }
      if let spine = film.spineNumber {
        FilmBadge(text: "Spine #\(spine)", fill: .lbBlue, foreground: Color(hex: 0x06131B))
      }
      if film.isWatched {
        FilmBadge(text: "Watched", systemImage: "eye.fill", fill: .lbGreen, foreground: .onAccent)
      } else {
        FilmBadge(text: "Unwatched", systemImage: "eye.slash", fill: .clear, foreground: .spineForeground, outlined: true)
      }
      if film.rtCriticsScore != nil || film.rtAudienceScore != nil {
        rtScores
      }
      Button(action: refreshRT) {
        Image(systemName: "arrow.clockwise")
          .font(.footnote.weight(.semibold))
          .foregroundStyle(.spineMutedForeground)
          .symbolEffect(.rotate, options: .repeat(.continuous), isActive: refreshingRT)
          .frame(width: 30, height: 26)
          .contentShape(.rect)
      }
      .buttonStyle(.plain)
      .disabled(refreshingRT)
      .accessibilityLabel(
        film.rtSyncedAt == nil ? "Fetch Rotten Tomatoes scores" : "Refresh Rotten Tomatoes scores")
    }
  }

  @ViewBuilder
  private var rtScores: some View {
    let badges = HStack(spacing: 6) {
      if let critics = film.rtCriticsScore {
        FilmBadge(
          text: "🍅 \(critics)%",
          fill: critics >= 60 ? Color(hex: 0xE01E26) : Color(hex: 0x6A7F10),
          foreground: .white)
      }
      if let audience = film.rtAudienceScore {
        FilmBadge(text: "🍿 \(audience)%", fill: .lbOrange, foreground: Color(hex: 0x1B0F04))
      }
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(rtAccessibilityLabel)

    if let url = film.rtUrl.flatMap(URL.init(string:)) {
      Link(destination: url) { badges }
        .accessibilityHint("Opens Rotten Tomatoes")
    } else {
      badges
    }
  }

  private var rtAccessibilityLabel: String {
    [
      film.rtCriticsScore.map { "Rotten Tomatoes critics \($0)%" },
      film.rtAudienceScore.map { "audience \($0)%" },
    ].compactMap { $0 }.joined(separator: ", ")
  }
}

private struct FilmBadge: View {
  let text: String
  var systemImage: String? = nil
  let fill: Color
  let foreground: Color
  var outlined = false

  var body: some View {
    HStack(spacing: 4) {
      if let systemImage { Image(systemName: systemImage).imageScale(.small) }
      Text(text).monospacedDigit()
    }
    .font(.caption.weight(.bold))
    .foregroundStyle(foreground)
    .padding(.horizontal, 9)
    .padding(.vertical, 5)
    .background(fill, in: .capsule)
    .overlay {
      if outlined { Capsule().strokeBorder(Color.white.opacity(0.25), lineWidth: 1) }
    }
    .fixedSize()
  }
}

// MARK: - TMDB

/// Shown when the title never matched on TMDB, with a retry.
struct FilmTmdbMissingCard: View {
  let pending: Bool
  let retry: () -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack(alignment: .firstTextBaseline, spacing: 10) {
        Image(systemName: "exclamationmark.triangle.fill")
          .foregroundStyle(.lbOrange)
          .accessibilityHidden(true)
        VStack(alignment: .leading, spacing: 4) {
          Text("No TMDB match")
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(.spineForeground)
          Text(
            "Cast, genres, studio, and the IMDb link are missing because this title wasn't found on TMDB. Check the title and year (Edit), then retry."
          )
          .font(.footnote)
          .foregroundStyle(.spineMutedForeground)
          .fixedSize(horizontal: false, vertical: true)
        }
      }
      Button(action: retry) {
        HStack(spacing: 6) {
          if pending {
            ProgressView().controlSize(.small)
          } else {
            Image(systemName: "arrow.clockwise")
          }
          Text("Retry match")
        }
        .font(.subheadline.weight(.semibold))
      }
      .buttonStyle(.glass)
      .disabled(pending)
      .padding(.leading, 26)
    }
    .padding(16)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(Color.lbOrange.opacity(0.1), in: .rect(cornerRadius: 14))
    .overlay {
      RoundedRectangle(cornerRadius: 14).strokeBorder(Color.lbOrange.opacity(0.4), lineWidth: 1)
    }
  }
}

// MARK: - Watched

/// The Letterboxd rating and like, where the watched state comes from, the
/// manual override, and links out.
struct FilmWatchedCard: View {
  let film: Film
  let pending: Bool
  let setWatched: (Bool?) -> Void

  var body: some View {
    let watched = film.isWatched
    VStack(alignment: .leading, spacing: 14) {
      VStack(alignment: .leading, spacing: 4) {
        HStack(spacing: 8) {
          Text("Watched tracking")
            .font(.headline)
            .foregroundStyle(.spineForeground)
          if let rating = film.letterboxdRating {
            Text(Formatters.stars(rating))
              .font(.subheadline.weight(.bold))
              .foregroundStyle(.lbGreen)
              .accessibilityLabel("Rated \(rating.formatted()) on Letterboxd")
          }
          if film.letterboxdLiked == true {
            Text("♥")
              .foregroundStyle(.lbOrange)
              .accessibilityLabel("Liked on Letterboxd")
          }
        }
        Text(explanation)
          .font(.footnote)
          .foregroundStyle(.spineMutedForeground)
          .fixedSize(horizontal: false, vertical: true)
      }

      FilmFlowLayout(spacing: 8, lineSpacing: 8) {
        markButton(watched: watched)
        if film.watchedOverride != nil {
          Button {
            setWatched(nil)
          } label: {
            Label("Follow sync", systemImage: "arrow.counterclockwise")
              .font(.subheadline.weight(.semibold))
              .foregroundStyle(.spineForeground)
          }
          .buttonStyle(.glass)
          .disabled(pending)
          .accessibilityHint("Lets the Letterboxd sync decide again")
        }
      }
      .sensoryFeedback(.selection, trigger: watched)

      if !links.isEmpty {
        Divider().overlay(Color.spineBorder)
        FilmFlowLayout(spacing: 8, lineSpacing: 8) {
          ForEach(links, id: \.title) { link in
            Link(destination: link.url) {
              HStack(spacing: 4) {
                Text(link.title)
                Image(systemName: "arrow.up.right").imageScale(.small)
              }
              .font(.footnote.weight(.semibold))
              .foregroundStyle(.spineForeground)
            }
            .buttonStyle(.glass)
            .accessibilityLabel("Open on \(link.title)")
          }
        }
      }
    }
    .padding(16)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(.spineCard, in: .rect(cornerRadius: 14))
    .overlay { RoundedRectangle(cornerRadius: 14).strokeBorder(.spineBorder, lineWidth: 1) }
  }

  @ViewBuilder
  private func markButton(watched: Bool) -> some View {
    let label = HStack(spacing: 6) {
      if pending {
        ProgressView().controlSize(.small)
      } else {
        Image(systemName: watched ? "eye.slash" : "eye")
      }
      Text("Mark \(watched ? "unwatched" : "watched")")
    }
    .font(.subheadline.weight(.semibold))

    if watched {
      Button { setWatched(false) } label: { label.foregroundStyle(.spineForeground) }
        .buttonStyle(.glass)
        .disabled(pending)
    } else {
      Button { setWatched(true) } label: { label.foregroundStyle(.onAccent) }
        .buttonStyle(.glassProminent)
        .tint(.lbGreen)
        .disabled(pending)
    }
  }

  private var explanation: String {
    if film.watchedOverride != nil {
      return "Manually pinned — the Letterboxd sync won't change this."
    }
    if film.letterboxdWatched {
      let date = film.letterboxdWatchedAt.map {
        " — first watched \($0.formatted(date: .abbreviated, time: .omitted))"
      }
      return "Synced from Letterboxd\(date ?? "")"
    }
    return "Following the Letterboxd sync (not seen yet)."
  }

  private var links: [(title: String, url: URL)] {
    var links: [(title: String, url: URL)] = []
    if let url = film.tmdbURL { links.append(("TMDB", url)) }
    if let url = film.imdbURL { links.append(("IMDb", url)) }
    if let url = film.letterboxdUri.flatMap(URL.init(string:)) { links.append(("Letterboxd", url)) }
    return links
  }
}

// MARK: - Disc details

struct FilmDiscDetails: View {
  let film: Film

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      SectionLabel("Disc details")
      VStack(spacing: 0) {
        ForEach(Array(rows.enumerated()), id: \.offset) { index, row in
          if index > 0 { Divider().overlay(Color.spineBorder) }
          MetaRow(label: row.label, value: row.value)
        }
      }
      .padding(.horizontal, 16)
      .padding(.vertical, 4)
      .background(.spineCard, in: .rect(cornerRadius: 14))
      .overlay { RoundedRectangle(cornerRadius: 14).strokeBorder(.spineBorder, lineWidth: 1) }
    }
  }

  /// Only the rows with something to say, so the dividers line up.
  private var rows: [(label: String, value: String)] {
    let details = film.tmdbDetails
    let all: [(String, String?)] = [
      ("Resolution", film.resolution),
      ("Audio", film.audio),
      ("HDR", film.hdr ?? "SDR"),
      ("Region", film.region),
      ("Publisher", film.label),
      ("Package", film.packageType),
      ("Edition", film.edition),
      ("Runtime", film.runtimeMinutes.flatMap { $0 > 0 ? Formatters.runtime($0) : nil }),
      ("Discs", film.discCount > 1 ? String(film.discCount) : nil),
      ("Barcode", film.barcode),
      ("Price paid", Formatters.price(film.pricePaid)),
      ("Studio", details?.productionCompanies.prefix(3).joined(separator: ", ")),
      ("Country", details?.productionCountries.joined(separator: ", ")),
      ("Added", film.createdAt.formatted(date: .abbreviated, time: .omitted)),
    ]
    return all.compactMap { label, value in
      guard let value, !value.isEmpty else { return nil }
      return (label, value)
    }
  }
}

// MARK: - Cast

/// Headshots in a horizontal shelf; each opens that person.
struct FilmCastScroller: View {
  let cast: [CastMember]

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      SectionLabel("Cast")
        .padding(.horizontal, 16)
      ScrollView(.horizontal) {
        LazyHStack(alignment: .top, spacing: 14) {
          ForEach(Array(cast.enumerated()), id: \.offset) { _, member in
            NavigationLink(value: Route.person(name: member.name)) {
              FilmCastCell(member: member)
            }
            .buttonStyle(.plain)
          }
        }
        .scrollTargetLayout()
      }
      .scrollIndicators(.hidden)
      .scrollTargetBehavior(.viewAligned)
      .contentMargins(.horizontal, 16, for: .scrollContent)
    }
  }
}

private struct FilmCastCell: View {
  let member: CastMember

  var body: some View {
    VStack(spacing: 6) {
      PersonAvatar(name: member.name, url: member.profileURL, size: 76)
        .overlay { Circle().strokeBorder(.spineBorder, lineWidth: 1) }
      VStack(spacing: 2) {
        Text(member.name)
          .font(.caption.weight(.semibold))
          .foregroundStyle(.spineForeground)
        if let character = member.character, !character.isEmpty {
          Text(character)
            .font(.caption2)
            .foregroundStyle(.spineMutedForeground)
        }
      }
      .lineLimit(2)
      .multilineTextAlignment(.center)
    }
    .frame(width: 88)
    .contentShape(.rect)
    .accessibilityElement(children: .combine)
  }
}

// MARK: - Review and notes

struct FilmTextBlock: View {
  let title: String
  let text: String
  /// The review sits as a quote, with a green rule down its side.
  let quoted: Bool

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      SectionLabel(title)
      Text(text)
        .font(.callout)
        .foregroundStyle(.spineForeground)
        .textSelection(.enabled)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.leading, quoted ? 14 : 0)
        .overlay(alignment: .leading) {
          if quoted {
            Capsule().fill(Color.lbGreen.opacity(0.5)).frame(width: 3)
          }
        }
    }
  }
}

// MARK: - Flow layout

/// Lays its children out in rows, wrapping when a row is full — for badges
/// and inline links.
struct FilmFlowLayout: Layout {
  var alignment: HorizontalAlignment = .leading
  var spacing: CGFloat = 6
  var lineSpacing: CGFloat = 6

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    let rows = arrange(subviews, maxWidth: proposal.width ?? .infinity)
    let height = rows.reduce(0) { $0 + $1.height } + lineSpacing * CGFloat(max(rows.count - 1, 0))
    let width = rows.map(\.width).max() ?? 0
    return CGSize(width: proposal.width.map { min($0, width) } ?? width, height: height)
  }

  func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    var y = bounds.minY
    for row in arrange(subviews, maxWidth: bounds.width) {
      var x =
        switch alignment {
        case .center: bounds.minX + (bounds.width - row.width) / 2
        case .trailing: bounds.maxX - row.width
        default: bounds.minX
        }
      for item in row.items {
        subviews[item.index].place(
          at: CGPoint(x: x, y: y + (row.height - item.size.height) / 2),
          proposal: ProposedViewSize(item.size))
        x += item.size.width + spacing
      }
      y += row.height + lineSpacing
    }
  }

  private struct Row {
    var items: [(index: Int, size: CGSize)] = []
    var width: CGFloat = 0
    var height: CGFloat = 0
  }

  private func arrange(_ subviews: Subviews, maxWidth: CGFloat) -> [Row] {
    var rows: [Row] = []
    var row = Row()
    for index in subviews.indices {
      var size = subviews[index].sizeThatFits(.unspecified)
      if size.width > maxWidth {
        size = subviews[index].sizeThatFits(ProposedViewSize(width: maxWidth, height: nil))
      }
      let needed = row.items.isEmpty ? size.width : row.width + spacing + size.width
      if needed > maxWidth, !row.items.isEmpty {
        rows.append(row)
        row = Row()
      }
      row.width = row.items.isEmpty ? size.width : row.width + spacing + size.width
      row.height = max(row.height, size.height)
      row.items.append((index, size))
    }
    if !row.items.isEmpty { rows.append(row) }
    return rows
  }
}
