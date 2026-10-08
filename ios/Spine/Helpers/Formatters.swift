import Foundation

/// Display formats shared with the web (src/lib/film-helpers.ts).
nonisolated enum Formatters {
  /// 102 → "1h 42m"; 45 → "45m".
  static func runtime(_ minutes: Int) -> String {
    let hours = minutes / 60
    let rest = minutes % 60
    return hours > 0 ? "\(hours)h \(rest)m" : "\(rest)m"
  }

  /// TMDB budget/revenue are USD: 160_000_000 → "$160M". Halves round
  /// away from zero, as the web's Intl formatting does ($2.25M → "$2.3M").
  static func usdCompact(_ amount: Double) -> String {
    amount.formatted(
      .currency(code: "USD")
        .notation(.compactName)
        .precision(.fractionLength(0...1))
        .rounded(rule: .toNearestOrAwayFromZero)
        .locale(Locale(identifier: "en_US")))
  }

  /// What the user paid, in pounds as on the web: "£14.99".
  static func price(_ value: Double) -> String {
    value.formatted(
      .currency(code: "GBP")
        .rounded(rule: .toNearestOrAwayFromZero)
        .locale(Locale(identifier: "en_GB")))
  }

  /// `pricePaid` arrives as a decimal string.
  static func price(_ value: String?) -> String? {
    value.flatMap(Double.init).map(price)
  }

  /// 12.4 → "12×"; 3.25 → "3.3×" (the web's `Math.round` / `toFixed(1)`).
  static func multiple(_ value: Double) -> String {
    if value >= 10 { return "\(Int((value + 0.5).rounded(.down)))×" }
    return value.formatted(
      .number.precision(.fractionLength(1)).rounded(rule: .toNearestOrAwayFromZero)
        .grouping(.never).locale(Locale(identifier: "en_US"))) + "×"
  }

  /// A Letterboxd star rating: 3.5 → "★★★½".
  static func stars(_ rating: Double) -> String {
    String(repeating: "★", count: Int(rating)) + (rating.truncatingRemainder(dividingBy: 1) != 0 ? "½" : "")
  }

  /// Plural-aware count: count(3, "title") → "3 titles".
  static func count(_ n: Int, _ noun: String, plural: String? = nil) -> String {
    "\(n) \(n == 1 ? noun : (plural ?? noun + "s"))"
  }
}
