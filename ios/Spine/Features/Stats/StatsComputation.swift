import Foundation

// The numbers behind the Stats tab: a pure port of `computeStats` and its
// helpers in src/routes/_app/stats.tsx. Orderings follow the web exactly —
// its `Array.prototype.sort` is stable, so ties keep the order the films (or
// first occurrences) arrived in, which is the server's sort-title order.

/// One bucket of a tally: a name and how many times it occurred.
nonisolated struct StatsCount: Hashable, Identifiable, Sendable {
  let name: String
  let count: Int
  var id: String { name }
}

/// A film in a ranked money list — box office, budget, return on budget.
nonisolated struct StatsRankedRow: Hashable, Identifiable, Sendable {
  /// The film's id.
  let id: String
  let name: String
  let value: Double
  let display: String
  var detail: String? = nil
}

/// Everything the Stats tab shows, computed from the collection.
nonisolated struct StatsSummary: Sendable {
  var totalTitles: Int
  var totalDiscs: Int
  var uniqueDirectors: Int
  var watched: Int
  var watchedPct: Int
  var oldest: Film?
  var newest: Film?
  /// Feature films only — TV sets store a whole series' runtime.
  var longest: Film?
  var shortest: Film?
  /// Oldest decade first.
  var byDecade: [StatsCount]
  var topDirectors: [StatsCount]
  var topActors: [StatsCount]
  var byFormat: [StatsCount]
  var byResolution: [StatsCount]
  var byRegion: [StatsCount]
  var publisherPackage: [StatsCount]
  var byPublisher: [StatsCount]
  var byProductionCompany: [StatsCount]
  var byGenre: [StatsCount]
  var byCountry: [StatsCount]
  var byLanguage: [StatsCount]
  /// Collections with at least two owned entries.
  var franchises: [StatsCount]
  /// Full lists, highest first — cards slice either end.
  var topBoxOffice: [StatsRankedRow]
  var topBudget: [StatsRankedRow]
  var returnOnBudget: [StatsRankedRow]
  /// BBFC first, then MPAA, then anything else A–Z.
  var byCertification: [StatsCount]
  var totalPaid: Double
  var pricedCount: Int
  var totalRuntimeMinutes: Int
  var totalBoxOffice: Double
  var boxOfficeCount: Int
  var avgCritics: Int?
  var avgAudience: Int?
  /// A headshot per actor name — the first credit that has one. Native
  /// only: the web's actor list has no photos.
  var actorPhotos: [String: URL]
}

/// BBFC first, MPAA after — anything unknown lands at the end.
nonisolated private let statsCertOrder = [
  "U", "PG", "12", "12A", "15", "18", "R18", "G", "PG-13", "R", "NC-17",
]

// TMDB codes the system's language names don't know.
nonisolated private let statsTmdbLanguages = ["cn": "Cantonese", "xx": "None"]

nonisolated func computeStats(_ films: [Film]) -> StatsSummary {
  let totalDiscs = films.reduce(0) { $0 + $1.discCount }
  let watched = films.filter(\.isWatched).count

  let priced = films.filter { $0.pricePaid != nil }
  let totalPaid = priced.reduce(0.0) { $0 + (Double($1.pricePaid ?? "") ?? 0) }

  // `f.tmdbDetails?.revenue` truthiness: present and non-zero.
  let withRevenue = films.filter { statsTruthy($0.tmdbDetails?.revenue) }
  let totalBoxOffice = withRevenue.reduce(0.0) { $0 + ($1.tmdbDetails?.revenue ?? 0) }

  // Full sorted lists — the cards slice their end (highest/lowest) locally.
  let topBoxOffice = statsStableSorted(withRevenue) {
    $0.tmdbDetails!.revenue! > $1.tmdbDetails!.revenue!
  }
  .map { film in
    let revenue = film.tmdbDetails!.revenue!
    return StatsRankedRow(
      id: film.id, name: film.title, value: revenue,
      display: Formatters.usdCompact(revenue))
  }

  let topBudget = statsStableSorted(films.filter { statsTruthy($0.tmdbDetails?.budget) }) {
    $0.tmdbDetails!.budget! > $1.tmdbDetails!.budget!
  }
  .map { film in
    let budget = film.tmdbDetails!.budget!
    return StatsRankedRow(
      id: film.id, name: film.title, value: budget,
      display: Formatters.usdCompact(budget))
  }

  // Return on budget — how many times each film made its money back.
  let returnOnBudget = statsStableSorted(
    films
      .filter { statsTruthy($0.tmdbDetails?.budget) && statsTruthy($0.tmdbDetails?.revenue) }
      .map { film in
        let budget = film.tmdbDetails!.budget!
        let revenue = film.tmdbDetails!.revenue!
        let multiple = revenue / budget
        let shown = multiple >= 10 ? "\(statsJSRound(multiple))" : statsToFixed1(multiple)
        return StatsRankedRow(
          id: film.id, name: film.title, value: multiple, display: "\(shown)×",
          detail: "\(Formatters.usdCompact(revenue)) on \(Formatters.usdCompact(budget))")
      }
  ) { $0.value > $1.value }

  let byCertification = statsStableSorted(
    statsTally(films) { $0.tmdbDetails?.certification }
  ) { a, b in
    let ai = statsCertOrder.firstIndex(of: a.name) ?? statsCertOrder.count
    let bi = statsCertOrder.firstIndex(of: b.name) ?? statsCertOrder.count
    return ai != bi ? ai < bi : statsLocaleCompare(a.name, b.name) == .orderedAscending
  }

  let withYear = films.filter { $0.year != nil }
  // Strict comparisons: the first film at the extreme wins.
  let oldest = withYear.reduce(nil as Film?) { best, film in
    best == nil || film.year! < best!.year! ? film : best
  }
  let newest = withYear.reduce(nil as Film?) { best, film in
    best == nil || film.year! > best!.year! ? film : best
  }

  // TV sets store total series runtime, which would dwarf any feature —
  // longest/shortest only compare films.
  let withRuntime = films.filter { $0.runtimeMinutes != nil && $0.tmdbMediaType != "tv" }
  let longest = withRuntime.reduce(nil as Film?) { best, film in
    best == nil || film.runtimeMinutes! > best!.runtimeMinutes! ? film : best
  }
  let shortest = withRuntime.reduce(nil as Film?) { best, film in
    best == nil || film.runtimeMinutes! < best!.runtimeMinutes! ? film : best
  }

  let byDecade = statsStableSorted(statsTally(withYear) { $0.decade }) {
    statsLocaleCompare($0.name, $1.name) == .orderedAscending
  }

  let directors = films.flatMap(\.directors)
  let cast = films.flatMap { $0.tmdbCast ?? [] }

  var actorPhotos: [String: URL] = [:]
  for member in cast where actorPhotos[member.name] == nil {
    if let url = member.profileURL { actorPhotos[member.name] = url }
  }

  let critics = films.compactMap(\.rtCriticsScore)
  let audience = films.compactMap(\.rtAudienceScore)

  return StatsSummary(
    totalTitles: films.count,
    totalDiscs: totalDiscs,
    uniqueDirectors: Set(directors.map { $0.lowercased() }).count,
    watched: watched,
    // The web divides by zero here (NaN), but never renders it: an empty
    // collection shows the empty state instead.
    watchedPct: films.isEmpty ? 0 : statsJSRound(Double(watched) / Double(films.count) * 100),
    oldest: oldest,
    newest: newest,
    longest: longest,
    shortest: shortest,
    byDecade: byDecade,
    topDirectors: statsTally(directors) { $0 },
    topActors: statsTally(cast) { $0.name },
    byFormat: statsTally(films) { $0.format },
    byResolution: statsTally(films) { $0.resolution },
    // `f.region && \`Region ${f.region}\``: an empty region stays "".
    byRegion: statsTally(films) { film in
      film.region.map { $0.isEmpty ? $0 : "Region \($0)" }
    },
    publisherPackage: statsTally(films) { film in
      guard let label = film.label, !label.isEmpty else { return nil }
      return "\(label) — \(film.packageType ?? "Standard")"
    },
    byPublisher: statsTally(films) { $0.label },
    byProductionCompany: statsTally(films.flatMap { $0.tmdbDetails?.productionCompanies ?? [] }) {
      $0
    },
    byGenre: statsTally(films.flatMap { $0.tmdbDetails?.genres ?? [] }) { $0 },
    byCountry: statsTally(films.flatMap { $0.tmdbDetails?.productionCountries ?? [] }) { $0 },
    byLanguage: statsTally(films) { statsLanguageName($0.tmdbDetails?.originalLanguage) },
    // A "franchise" needs at least two owned entries — one is just a film.
    franchises: statsTally(films) { $0.tmdbDetails?.collection }.filter { $0.count >= 2 },
    topBoxOffice: topBoxOffice,
    topBudget: topBudget,
    returnOnBudget: returnOnBudget,
    byCertification: byCertification,
    totalPaid: totalPaid,
    pricedCount: priced.count,
    totalRuntimeMinutes: films.reduce(0) { $0 + ($1.runtimeMinutes ?? 0) },
    totalBoxOffice: totalBoxOffice,
    boxOfficeCount: withRevenue.count,
    avgCritics: statsMean(critics),
    avgAudience: statsMean(audience),
    actorPhotos: actorPhotos)
}

/// "8,340 minutes" reads as nothing — days + hours lands.
nonisolated func statsFormatDays(_ minutes: Int) -> String {
  let days = Int((Double(minutes) / 60 / 24).rounded(.down))
  let hours = statsJSRound(Double(minutes - days * 24 * 60) / 60)
  return days > 0 ? "\(days)d \(hours)h" : "\(hours)h"
}

/// An ISO 639-1 code as an English language name ("ja" → "Japanese").
nonisolated func statsLanguageName(_ code: String?) -> String? {
  guard let code, !code.isEmpty else { return nil }
  if let known = statsTmdbLanguages[code] { return known }
  return Locale(identifier: "en").localizedString(forLanguageCode: code) ?? code
}

// MARK: - JavaScript semantics

/// Count occurrences of each non-nil key, most frequent first; ties keep
/// first-seen order (the web's Map insertion order + stable sort).
nonisolated func statsTally<S: Sequence>(
  _ items: S, _ key: (S.Element) -> String?
) -> [StatsCount] {
  var order: [String] = []
  var counts: [String: Int] = [:]
  for item in items {
    guard let name = key(item) else { continue }
    if counts[name] == nil { order.append(name) }
    counts[name, default: 0] += 1
  }
  return statsStableSorted(order.map { StatsCount(name: $0, count: counts[$0]!) }) {
    $0.count > $1.count
  }
}

/// A stable sort, as JS's `Array.prototype.sort` guarantees.
nonisolated private func statsStableSorted<T>(
  _ items: [T], by areInIncreasingOrder: (T, T) -> Bool
) -> [T] {
  items.enumerated()
    .sorted { a, b in
      if areInIncreasingOrder(a.element, b.element) { return true }
      if areInIncreasingOrder(b.element, a.element) { return false }
      return a.offset < b.offset
    }
    .map(\.element)
}

/// `String.prototype.localeCompare` in an English locale.
nonisolated private func statsLocaleCompare(_ a: String, _ b: String) -> ComparisonResult {
  a.compare(b, locale: Locale(identifier: "en"))
}

/// JS truthiness of an optional number: present, non-zero, not NaN.
nonisolated private func statsTruthy(_ value: Double?) -> Bool {
  guard let value else { return false }
  return value != 0 && !value.isNaN
}

/// `Math.round`: halves round towards +∞.
nonisolated func statsJSRound(_ value: Double) -> Int {
  let floor = value.rounded(.down)
  return Int(value - floor >= 0.5 ? floor + 1 : floor)
}

/// `Number.prototype.toFixed(1)`. JS rounds the exact binary value with
/// ties going up; printf rounds it with ties to even. The only exact ties at
/// one decimal are x.25 and x.75, and they disagree only on x.25.
nonisolated func statsToFixed1(_ value: Double) -> String {
  let quarters = value * 4
  if quarters == quarters.rounded(.down), quarters.truncatingRemainder(dividingBy: 4) == 1 {
    return String(format: "%.1f", value + 0.05)
  }
  return String(format: "%.1f", value)
}

nonisolated private func statsMean(_ values: [Int]) -> Int? {
  values.isEmpty ? nil : statsJSRound(Double(values.reduce(0, +)) / Double(values.count))
}
