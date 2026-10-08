import Foundation

/// The physical case, as it lies in the pile — the web's `pileCase` and
/// `pileOffset` (src/lib/shelf-pile.ts), so a pile draws alike on both.
nonisolated struct ShelfCaseShape {
  /// Length as a fraction of the longest case (a DVD's).
  let length: CGFloat
  /// Spine thickness in points.
  let thickness: CGFloat
  /// A nudge left or right, the same every time for a disc.
  let offset: CGFloat

  /// Case height (its length lying flat) and spine thickness, in mm.
  private static let cases: [String: (length: Double, thickness: Double)] = [
    "DVD": (190, 14), "Blu-ray": (170, 11), "4K UHD": (170, 12),
  ]
  private static let longestCase = 190.0
  /// Spine millimetres to points: a Blu-ray case comes out 26 pt thick.
  private static let pointsPerMM = 2.4
  /// No thinner than a comfortable tap target, no thicker than a box set
  /// needs.
  private static let thicknessRange = 24.0...64.0

  init(format: String?, packageType: String? = nil, discCount: Int = 1, key: String) {
    let size = format.flatMap { Self.cases[$0] } ?? Self.cases["Blu-ray"]!
    var mm = size.thickness
    if packageType == "Steelbook" { mm = min(mm, 10) }
    if packageType == "Boxset" || packageType == "Mediabook" { mm += 8 }
    // A standard case holds two discs; more need a fatter one.
    mm += min(12, Double(max(0, discCount - 2)) * 3)
    length = size.length / Self.longestCase
    let points = (mm * Self.pointsPerMM).rounded()
    thickness = min(Self.thicknessRange.upperBound, max(Self.thicknessRange.lowerBound, points))
    offset = CGFloat(Self.nudge(key))
  }

  /// A small, steady sideways nudge within ±6, so a pile looks hand-stacked
  /// rather than ruled — FNV-1a over the id, as the web does.
  static func nudge(_ id: String, max: Int = 6) -> Int {
    var hash: UInt32 = 0x811c_9dc5
    for unit in id.utf16 {
      hash ^= UInt32(unit)
      hash = hash &* 0x0100_0193
    }
    return Int(hash % UInt32(2 * max + 1)) - max
  }
}
