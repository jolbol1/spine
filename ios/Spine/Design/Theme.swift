import SwiftUI

/// The web's single dark theme (src/styles.css): Letterboxd charcoal-blue
/// with the green / blue / orange accent trio.
extension ShapeStyle where Self == Color {
  /// Page background, #14181c.
  static var spineBackground: Color { Color(hex: 0x14181C) }
  /// Raised surfaces — cards, grouped rows. #1b222a.
  static var spineCard: Color { Color(hex: 0x1B222A) }
  /// Popovers and sheets. #202933.
  static var spinePopover: Color { Color(hex: 0x202933) }
  /// Secondary fills — chips, placeholders, inactive controls. #2c3440.
  static var spineSecondary: Color { Color(hex: 0x2C3440) }
  /// #232b34.
  static var spineMuted: Color { Color(hex: 0x232B34) }
  /// Primary text, #f4f7fa.
  static var spineForeground: Color { Color(hex: 0xF4F7FA) }
  /// Secondary text, #94a6b8.
  static var spineMutedForeground: Color { Color(hex: 0x94A6B8) }
  /// Hairlines — white at 9%.
  static var spineBorder: Color { Color.white.opacity(0.09) }
  static var spineDestructive: Color { Color(hex: 0xFF6467) }

  /// Watched, primary actions. #00e054.
  static var lbGreen: Color { Color(hex: 0x00E054) }
  /// Blu-ray, links, spine numbers. #40bcf4.
  static var lbBlue: Color { Color(hex: 0x40BCF4) }
  /// 4K, warnings, The Oracle. #ff8000.
  static var lbOrange: Color { Color(hex: 0xFF8000) }
  /// Chart series 4 / DVD. #94a6b8.
  static var chart4: Color { Color(hex: 0x94A6B8) }
  /// Chart series 5. #56637a.
  static var chart5: Color { Color(hex: 0x56637A) }

  /// Dark text that sits on the bright accents.
  static var onAccent: Color { Color(hex: 0x07130B) }
}

extension Color {
  init(hex: UInt32, opacity: Double = 1) {
    self.init(
      .sRGB,
      red: Double((hex >> 16) & 0xFF) / 255,
      green: Double((hex >> 8) & 0xFF) / 255,
      blue: Double(hex & 0xFF) / 255,
      opacity: opacity)
  }

  /// The chart palette, in series order (--chart-1 … --chart-5).
  static let chartPalette: [Color] = [.lbGreen, .lbBlue, .lbOrange, .chart4, .chart5]

  /// Badge fill and text per disc format — 4K pops, Blu-ray blue, DVD muted.
  static func formatBadge(_ format: String) -> (fill: Color, text: Color) {
    switch format {
    case "4K UHD": (.lbOrange, Color(hex: 0x1B0F04))
    case "Blu-ray": (.lbBlue, Color(hex: 0x06131B))
    case "DVD": (.chart4, Color(hex: 0x0B1016))
    default: (.spineSecondary, .spineForeground)
    }
  }
}

extension View {
  /// The app's page background behind a scroll view, list, or form.
  func spineScreenBackground() -> some View {
    scrollContentBackground(.hidden)
      .background(Color.spineBackground.ignoresSafeArea())
  }
}
