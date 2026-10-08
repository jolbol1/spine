import SwiftUI

// MARK: - Card chrome

/// A stats card: small-caps title, an optional trailing accessory, content.
struct StatsCard<Accessory: View, Content: View>: View {
  let title: String
  @ViewBuilder var accessory: () -> Accessory
  @ViewBuilder var content: () -> Content

  var body: some View {
    VStack(alignment: .leading, spacing: 14) {
      HStack(alignment: .center, spacing: 8) {
        SectionLabel(title)
          .frame(maxWidth: .infinity, alignment: .leading)
        accessory()
      }
      .frame(minHeight: 22)
      content()
    }
    .padding(16)
    .frame(maxWidth: .infinity, alignment: .leading)
    .statsSurface()
  }
}

extension StatsCard where Accessory == EmptyView {
  init(title: String, @ViewBuilder content: @escaping () -> Content) {
    self.init(title: title, accessory: { EmptyView() }, content: content)
  }
}

extension View {
  /// The raised card surface used across the Stats tab.
  func statsSurface(cornerRadius: CGFloat = 16) -> some View {
    background(.spineCard, in: .rect(cornerRadius: cornerRadius))
      .overlay {
        RoundedRectangle(cornerRadius: cornerRadius)
          .strokeBorder(.spineBorder, lineWidth: 1)
      }
  }
}

/// "No data yet." inside a card.
struct StatsEmptyNote: View {
  let text: String

  init(_ text: String) { self.text = text }

  var body: some View {
    Text(text)
      .font(.subheadline)
      .foregroundStyle(.spineMutedForeground)
      .frame(maxWidth: .infinity, alignment: .leading)
  }
}

/// A thin value bar on a muted track — the web's `h-1.5` row bars.
struct StatsBar: View {
  /// 0…1 of the track.
  let fraction: Double
  let color: Color

  var body: some View {
    Capsule()
      .fill(.spineSecondary)
      .frame(height: 6)
      .overlay(alignment: .leading) {
        GeometryReader { proxy in
          Capsule()
            .fill(color)
            .frame(width: proxy.size.width * min(max(fraction, 0), 1))
        }
      }
      .accessibilityHidden(true)
  }
}

extension Color {
  /// The web's ACCENTS / CHART_COLORS cycle: green, blue, orange, …
  static func statsAccent(_ index: Int) -> Color {
    chartPalette[index % chartPalette.count]
  }
}

// MARK: - Headline tiles

/// The headline numbers — two across on iPhone, four on iPad, as the web's
/// `grid-cols-2 md:grid-cols-4`.
struct StatsTileGrid: View {
  let stats: StatsSummary
  let columns: Int

  var body: some View {
    let tiles = makeTiles()
    Grid(horizontalSpacing: 12, verticalSpacing: 12) {
      ForEach(Array(stride(from: 0, to: tiles.count, by: columns)), id: \.self) { start in
        GridRow(alignment: .top) {
          ForEach(tiles[start..<min(start + columns, tiles.count)]) { tile in
            StatsTileView(tile: tile)
          }
        }
      }
    }
  }

  private func makeTiles() -> [StatsTile] {
    let s = stats
    let dash = "—"
    return [
      StatsTile(label: "Total discs", value: "\(s.totalDiscs)", accent: .lbGreen),
      StatsTile(label: "Top-level titles", value: "\(s.totalTitles)"),
      StatsTile(label: "Unique directors", value: "\(s.uniqueDirectors)"),
      StatsTile(
        label: "Watched", value: "\(s.watchedPct)%",
        detail: "\(s.watched) of \(s.totalTitles) titles", accent: .lbGreen,
        progress: s.totalTitles > 0 ? Double(s.watched) / Double(s.totalTitles) : 0),
      StatsTile(
        label: "Oldest title", value: s.oldest?.year.map { "\($0)" } ?? dash,
        detail: s.oldest?.title, film: s.oldest),
      StatsTile(
        label: "Newest title", value: s.newest?.year.map { "\($0)" } ?? dash,
        detail: s.newest?.title, film: s.newest),
      StatsTile(
        label: "Longest runtime", value: runtime(s.longest) ?? dash,
        detail: s.longest?.title, accent: .lbOrange, film: s.longest),
      StatsTile(
        label: "Shortest runtime", value: runtime(s.shortest) ?? dash,
        detail: s.shortest?.title, film: s.shortest),
      StatsTile(
        label: "Total paid",
        value: s.totalPaid > 0 ? Formatters.price(s.totalPaid) : dash,
        detail: s.pricedCount > 0
          ? "\(s.pricedCount) of \(s.totalTitles) priced · avg \(Formatters.price(s.totalPaid / Double(s.pricedCount)))"
          : "Add prices from each film's edit form",
        accent: .lbGreen),
      StatsTile(
        label: "Shelf runtime",
        value: s.totalRuntimeMinutes > 0 ? statsFormatDays(s.totalRuntimeMinutes) : dash,
        detail: "every disc back to back"),
      StatsTile(
        label: "Combined box office",
        value: s.totalBoxOffice > 0 ? Formatters.usdCompact(s.totalBoxOffice) : dash,
        detail: s.boxOfficeCount > 0
          ? "worldwide gross across \(s.boxOfficeCount) films" : nil,
        accent: .lbOrange),
      StatsTile(
        label: "Rotten Tomatoes avg", value: s.avgCritics.map { "\($0)%" } ?? dash,
        detail: s.avgAudience.map { "critics · audience \($0)%" } ?? "Sync scores from Settings"),
    ]
  }

  /// The web shows "—" for a missing or zero runtime.
  private func runtime(_ film: Film?) -> String? {
    guard let minutes = film?.runtimeMinutes, minutes != 0 else { return nil }
    return Formatters.runtime(minutes)
  }
}

struct StatsTile: Identifiable {
  let label: String
  let value: String
  var detail: String? = nil
  var accent: Color = .spineForeground
  /// 0…1 — draws a progress bar under the detail.
  var progress: Double? = nil
  /// Tapping the tile opens this film.
  var film: Film? = nil

  var id: String { label }
}

private struct StatsTileView: View {
  let tile: StatsTile

  var body: some View {
    if let film = tile.film {
      NavigationLink(value: Route.film(id: film.id)) {
        content(linked: true)
      }
      .buttonStyle(StatsPressStyle())
      .accessibilityHint("Opens \(film.title)")
    } else {
      content(linked: false)
    }
  }

  private func content(linked: Bool) -> some View {
    VStack(alignment: .leading, spacing: 4) {
      HStack(alignment: .firstTextBaseline, spacing: 4) {
        SectionLabel(tile.label)
          .frame(maxWidth: .infinity, alignment: .leading)
        if linked {
          Image(systemName: "chevron.right")
            .font(.caption2.weight(.bold))
            .foregroundStyle(.spineMutedForeground.opacity(0.7))
        }
      }
      Text(tile.value)
        .font(.title2.weight(.bold))
        .monospacedDigit()
        // A missing value reads as absent, not as an orange/green dash.
        .foregroundStyle(tile.value == "—" ? .spineMutedForeground : tile.accent)
        .lineLimit(1)
        .minimumScaleFactor(0.6)
        .contentTransition(.numericText())
      if let detail = tile.detail {
        Text(detail)
          .font(.caption)
          .foregroundStyle(.spineMutedForeground)
          .lineLimit(2)
          .fixedSize(horizontal: false, vertical: true)
      }
      if let progress = tile.progress {
        StatsBar(fraction: progress, color: tile.accent)
          .padding(.top, 6)
      }
    }
    .padding(14)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    .contentShape(.rect)
    .statsSurface(cornerRadius: 14)
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(tile.label)
    .accessibilityValue([tile.value, tile.detail].compactMap { $0 }.joined(separator: ", "))
  }
}

/// Plain rows that dim while pressed, like a list row's highlight.
struct StatsPressStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .opacity(configuration.isPressed ? 0.6 : 1)
      .animation(.easeOut(duration: 0.15), value: configuration.isPressed)
  }
}

// MARK: - Breakdown (tally) cards

/// A ranked tally with share-of-total bars — directors, actors, publishers,
/// genres, … (the web's BreakdownCard).
struct StatsBreakdownCard: View {
  enum People {
    case none
    case directors
    /// Actors, with a headshot per name where TMDB has one.
    case actors(photos: [String: URL])
  }

  let title: String
  let rows: [StatsCount]
  var max: Int = 8
  /// Link each row's name to its person page.
  var people: People = .none

  var body: some View {
    let top = rows.prefix(max)
    let total = rows.reduce(0) { $0 + $1.count }
    StatsCard(title: title) {
      if top.isEmpty {
        StatsEmptyNote(StatsCopy.empty)
      } else {
        VStack(spacing: 12) {
          ForEach(Array(top.enumerated()), id: \.element.id) { index, row in
            let fraction = Swift.max(0.04, Double(row.count) / Double(total))
            switch people {
            case .none:
              StatsBreakdownRow(row: row, fraction: fraction, color: .statsAccent(index))
            case .directors:
              NavigationLink(value: Route.person(name: row.name)) {
                StatsBreakdownRow(
                  row: row, fraction: fraction, color: .statsAccent(index), linked: true)
              }
              .buttonStyle(StatsPressStyle())
            case .actors(let photos):
              NavigationLink(value: Route.person(name: row.name)) {
                StatsBreakdownRow(
                  row: row, fraction: fraction, color: .statsAccent(index), linked: true,
                  showsAvatar: true, photoURL: photos[row.name])
              }
              .buttonStyle(StatsPressStyle())
            }
          }
        }
      }
    }
  }
}

private struct StatsBreakdownRow: View {
  let row: StatsCount
  let fraction: Double
  let color: Color
  var linked = false
  /// A leading headshot, or initials when there's no photo.
  var showsAvatar = false
  var photoURL: URL? = nil

  var body: some View {
    HStack(spacing: 12) {
      if showsAvatar {
        PersonAvatar(name: row.name, url: photoURL, size: 34)
      }
      VStack(alignment: .leading, spacing: 6) {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
          Text(row.name)
            .font(.subheadline)
            .foregroundStyle(.spineForeground)
            .lineLimit(1)
            .truncationMode(.tail)
          Spacer(minLength: 4)
          Text("\(row.count)")
            .font(.caption)
            .monospacedDigit()
            .foregroundStyle(.spineMutedForeground)
        }
        StatsBar(fraction: fraction, color: color)
      }
      if linked {
        Image(systemName: "chevron.right")
          .font(.caption2.weight(.bold))
          .foregroundStyle(.spineMutedForeground.opacity(0.7))
      }
    }
    .contentShape(.rect)
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(row.name)
    .accessibilityValue(Formatters.count(row.count, "title"))
  }
}

// MARK: - Ranked film cards

/// Ranked films with value bars — top box office, budgets, ROI. `rows`
/// arrives highest first; the toggle flips to the lowest end (the web's
/// RankedCard).
struct StatsRankedCard: View {
  let title: String
  let lowTitle: String
  let rows: [StatsRankedRow]
  var max: Int = 10

  @State private var lowest = false

  var body: some View {
    let shown = lowest ? Array(rows.suffix(max).reversed()) : Array(rows.prefix(max))
    let top = Swift.max(shown.map(\.value).max() ?? 0, 1e-9)
    StatsCard(title: lowest ? lowTitle : title) {
      if rows.count > 1 {
        Button {
          withAnimation(.snappy) { lowest.toggle() }
        } label: {
          Label(
            lowest ? "Show highest" : "Show lowest",
            systemImage: lowest ? "arrow.up" : "arrow.down")
            .font(.caption.weight(.medium))
        }
        .buttonStyle(.glass)
        .controlSize(.small)
        .tint(.spineMutedForeground)
        .sensoryFeedback(.selection, trigger: lowest)
      }
    } content: {
      if shown.isEmpty {
        StatsEmptyNote(StatsCopy.tmdbEmpty)
      } else {
        VStack(spacing: 12) {
          ForEach(Array(shown.enumerated()), id: \.element.id) { index, row in
            NavigationLink(value: Route.film(id: row.id)) {
              StatsRankedRowView(
                row: row, fraction: Swift.max(0.04, row.value / top), color: .statsAccent(index))
            }
            .buttonStyle(StatsPressStyle())
          }
        }
      }
    }
  }
}

private struct StatsRankedRowView: View {
  let row: StatsRankedRow
  let fraction: Double
  let color: Color

  var body: some View {
    HStack(spacing: 12) {
      VStack(alignment: .leading, spacing: 6) {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
          Text(row.name)
            .font(.subheadline)
            .foregroundStyle(.spineForeground)
            .lineLimit(1)
          Spacer(minLength: 4)
          Text(row.display)
            .font(.caption.weight(.semibold))
            .monospacedDigit()
            .foregroundStyle(.spineForeground.opacity(0.85))
        }
        if let detail = row.detail {
          Text(detail)
            .font(.caption)
            .monospacedDigit()
            .foregroundStyle(.spineMutedForeground)
            .padding(.top, -3)
        }
        StatsBar(fraction: fraction, color: color)
      }
      Image(systemName: "chevron.right")
        .font(.caption2.weight(.bold))
        .foregroundStyle(.spineMutedForeground.opacity(0.7))
    }
    .contentShape(.rect)
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(row.name)
    .accessibilityValue([row.display, row.detail].compactMap { $0 }.joined(separator: ", "))
  }
}
