import SwiftUI

/// The Stats tab — "the state of the shelf" (src/routes/_app/stats.tsx):
/// headline numbers, then every chart and breakdown the web shows.
struct StatsView: View {
  @Environment(Library.self) private var library
  @Environment(Router.self) private var router
  @Environment(Toasts.self) private var toasts

  var body: some View {
    NavigationStack(path: router.path(for: .stats)) {
      content
        .navigationTitle("Stats")
        .toolbar { AccountButton() }
        .routeDestinations()
    }
  }

  @ViewBuilder private var content: some View {
    if !library.hasLoadedFilms {
      if let error = library.loadError {
        LoadFailedView(message: error) { await library.refreshAll() }
      } else {
        LoadingView()
      }
    } else if library.films.isEmpty {
      StatsEmptyState(refresh: refresh)
    } else {
      StatsDashboard(stats: computeStats(library.films), refresh: refresh)
    }
  }

  private func refresh() async {
    do {
      try await library.refreshFilms()
    } catch is CancellationError {
    } catch {
      toasts.error(error)
    }
  }
}

/// The web's empty state: "No stats yet — Add some films and the numbers
/// will appear here", with the link opening Add a film.
private struct StatsEmptyState: View {
  let refresh: () async -> Void
  @Environment(Router.self) private var router

  var body: some View {
    ScrollView {
      ContentUnavailableView {
        Label("No stats yet", systemImage: "chart.bar.xaxis")
      } description: {
        Text("[Add some films](spine://add-film) and the numbers will appear here.")
      }
      .containerRelativeFrame(.vertical)
    }
    .tint(.lbBlue)
    .environment(
      \.openURL,
      OpenURLAction { _ in
        router.sheet = .addFilm(scan: false)
        return .handled
      }
    )
    .refreshable { await refresh() }
    .spineScreenBackground()
  }
}

/// Headline tiles, the decade chart, then the cards — one column on iPhone,
/// two on iPad.
private struct StatsDashboard: View {
  let stats: StatsSummary
  let refresh: () async -> Void
  @Environment(\.horizontalSizeClass) private var sizeClass
  @Environment(\.dynamicTypeSize) private var typeSize

  private var isRegular: Bool { sizeClass == .regular }

  private var tileColumns: Int {
    if isRegular { return 4 }
    return typeSize >= .accessibility3 ? 1 : 2
  }

  var body: some View {
    ScrollView {
      VStack(spacing: 16) {
        StatsTileGrid(stats: stats, columns: tileColumns)

        StatsBarChartCard(
          title: "Titles by decade", rows: stats.byDecade, color: .lbGreen,
          axisName: "Decade", height: isRegular ? 260 : 220)

        StatsMasonryLayout(columns: isRegular ? 2 : 1, spacing: 16) {
          StatsDonutCard(title: "Media type", rows: stats.byFormat)
          StatsDonutCard(title: "Resolution", rows: stats.byResolution)
          StatsBarChartCard(
            title: "Disc region", rows: stats.byRegion, color: .lbBlue, axisName: "Region",
            // "Region Free" et al. crowd a phone-width axis; the card title
            // already says what they are.
            axisLabel: { $0.hasPrefix("Region ") ? String($0.dropFirst(7)) : $0 })
          StatsBarChartCard(
            title: "Age rating", rows: stats.byCertification, color: .lbOrange,
            axisName: "Rating", emptyText: StatsCopy.tmdbEmpty)
          StatsRankedCard(
            title: "Biggest box office", lowTitle: "Smallest box office",
            rows: stats.topBoxOffice)
          StatsRankedCard(
            title: "Biggest budgets", lowTitle: "Lowest budgets", rows: stats.topBudget)
          StatsRankedCard(
            title: "Best return on budget", lowTitle: "Worst return on budget",
            rows: stats.returnOnBudget)
          StatsBreakdownCard(title: "Top directors", rows: stats.topDirectors, people: .directors)
          StatsBreakdownCard(
            title: "Top actors", rows: stats.topActors, max: 10,
            people: .actors(photos: stats.actorPhotos))
          StatsBreakdownCard(title: "Top publishers", rows: stats.byPublisher, max: 10)
          StatsBreakdownCard(
            title: "Publisher by package type", rows: stats.publisherPackage, max: 10)
          StatsBreakdownCard(
            title: "Production companies", rows: stats.byProductionCompany, max: 10)
          StatsBreakdownCard(title: "Genres", rows: stats.byGenre, max: 10)
          StatsBreakdownCard(title: "Countries", rows: stats.byCountry, max: 10)
          StatsBreakdownCard(title: "Languages", rows: stats.byLanguage, max: 8)
          StatsBreakdownCard(title: "Franchises on the shelf", rows: stats.franchises, max: 8)
        }
      }
      .padding(.horizontal, 16)
      .padding(.top, 8)
      .padding(.bottom, 24)
      .frame(maxWidth: 1200)
      .frame(maxWidth: .infinity)
    }
    .refreshable { await refresh() }
    .spineScreenBackground()
    .navigationSubtitle("The state of the shelf.")
  }
}

/// Copy shared between cards.
enum StatsCopy {
  static let empty = "No data yet."
  static let tmdbEmpty = "No data yet — run the TMDB details sync in Settings."
}

/// Places each card in the currently shortest column, so cards of different
/// heights pack without the gaps a row-aligned grid leaves. One column is a
/// plain stack.
struct StatsMasonryLayout: Layout {
  var columns: Int
  var spacing: CGFloat

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    let width = proposal.width ?? 400
    return CGSize(width: width, height: arrange(width: width, subviews: subviews).height)
  }

  func placeSubviews(
    in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()
  ) {
    let frames = arrange(width: bounds.width, subviews: subviews).frames
    for (subview, frame) in zip(subviews, frames) {
      subview.place(
        at: CGPoint(x: bounds.minX + frame.minX, y: bounds.minY + frame.minY),
        proposal: ProposedViewSize(width: frame.width, height: frame.height))
    }
  }

  private func arrange(width: CGFloat, subviews: Subviews) -> (frames: [CGRect], height: CGFloat) {
    let count = max(columns, 1)
    let columnWidth = (width - spacing * CGFloat(count - 1)) / CGFloat(count)
    var bottoms = Array(repeating: CGFloat(0), count: count)
    var started = Array(repeating: false, count: count)
    var frames: [CGRect] = []
    for subview in subviews {
      let size = subview.sizeThatFits(ProposedViewSize(width: columnWidth, height: nil))
      let column = bottoms.indices.min { bottoms[$0] < bottoms[$1] } ?? 0
      let y = started[column] ? bottoms[column] + spacing : 0
      frames.append(
        CGRect(
          x: CGFloat(column) * (columnWidth + spacing), y: y, width: columnWidth,
          height: size.height))
      bottoms[column] = y + size.height
      started[column] = true
    }
    return (frames, bottoms.max() ?? 0)
  }
}
