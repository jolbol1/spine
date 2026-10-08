import SwiftUI

/// The Spine mark — three cases on a shelf in the Letterboxd trio, the last
/// one leaning. Same artwork as the web favicon (public/favicon.svg).
struct SpineMark: View {
  var body: some View {
    Canvas { context, size in
      // Artwork space: x 96…426, y 120…416 (the web's viewBox).
      let scale = min(size.width / 330, size.height / 296)
      context.translateBy(
        x: (size.width - 330 * scale) / 2 - 96 * scale,
        y: (size.height - 296 * scale) / 2 - 120 * scale)
      context.scaleBy(x: scale, y: scale)

      func spine(_ x: CGFloat, _ color: Color, in context: GraphicsContext) {
        context.fill(
          Path(roundedRect: CGRect(x: x, y: 136, width: 68, height: 256), cornerRadius: 15),
          with: .color(color))
      }
      spine(122, .lbOrange, in: context)
      spine(206, .lbGreen, in: context)

      var leaning = context
      leaning.translateBy(x: 318, y: 392)
      leaning.rotate(by: .degrees(-15))
      leaning.translateBy(x: -318, y: -392)
      leaning.blendMode = .screen
      spine(318, .lbBlue, in: leaning)

      context.fill(
        Path(roundedRect: CGRect(x: 106, y: 398, width: 300, height: 12), cornerRadius: 6),
        with: .color(.white.opacity(0.25)))
    }
    .aspectRatio(330 / 296, contentMode: .fit)
    .accessibilityHidden(true)
  }
}

/// Mark plus wordmark, as in the web header.
struct SpineBrand: View {
  var markHeight: CGFloat = 24

  var body: some View {
    HStack(spacing: markHeight * 0.4) {
      SpineMark().frame(height: markHeight)
      Text("SPINE")
        .font(.system(size: markHeight * 0.75, weight: .heavy))
        .tracking(markHeight * 0.18)
        .foregroundStyle(.spineForeground)
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("Spine")
  }
}

#Preview {
  VStack(spacing: 32) {
    SpineMark().frame(height: 120)
    SpineBrand()
  }
  .padding()
  .background(.spineBackground)
}
