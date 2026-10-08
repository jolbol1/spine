import SwiftUI

/// No shelves yet: what shelves are, three starter layouts, and a blank one.
struct ShelvesEmptyState: View {
  var onTemplate: (ShelfTemplate) -> Void
  var onNewShelf: () -> Void

  var body: some View {
    ScrollView {
      VStack(spacing: 24) {
        VStack(spacing: 10) {
          Image(systemName: "books.vertical")
            .font(.system(size: 44, weight: .regular))
            .foregroundStyle(.spineMutedForeground)
            .padding(.bottom, 4)
            .accessibilityHidden(true)
          Text("No shelves yet")
            .font(.title2.weight(.bold))
            .foregroundStyle(.spineForeground)
            .accessibilityAddTraits(.isHeader)
          Text(
            "Shelves are a digital twin of your physical wall: every film lands on exactly one shelf, top shelf wins. Start from a template or build your own."
          )
          .font(.subheadline)
          .foregroundStyle(.spineMutedForeground)
          .multilineTextAlignment(.center)
          .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 8)

        LazyVGrid(columns: [GridItem(.adaptive(minimum: 220), spacing: 12)], spacing: 12) {
          ForEach(ShelfTemplate.allCases) { template in
            Button {
              onTemplate(template)
            } label: {
              VStack(alignment: .leading, spacing: 6) {
                Label(template.label, systemImage: "sparkles")
                  .font(.subheadline.weight(.semibold))
                  .foregroundStyle(.spineForeground)
                  .labelStyle(ShelfTemplateLabelStyle())
                Text(template.summary)
                  .font(.footnote)
                  .foregroundStyle(.spineMutedForeground)
                  .multilineTextAlignment(.leading)
                  .fixedSize(horizontal: false, vertical: true)
              }
              .frame(maxWidth: .infinity, alignment: .topLeading)
              .padding(14)
              .background(.spineCard, in: .rect(cornerRadius: 14))
              .overlay {
                RoundedRectangle(cornerRadius: 14).strokeBorder(.spineBorder, lineWidth: 1)
              }
              .contentShape(.rect(cornerRadius: 14))
            }
            .buttonStyle(ShelfPressStyle())
            .accessibilityHint(template.summary)
          }
        }

        Button("New Custom Shelf", systemImage: "plus", action: onNewShelf)
          .buttonStyle(.glass)
          .controlSize(.large)
      }
      .frame(maxWidth: 720)
      .padding(.horizontal, 16)
      .padding(.top, 12)
      .padding(.bottom, 24)
      .frame(maxWidth: .infinity)
    }
  }
}

/// The green sparkle beside a template's name.
private struct ShelfTemplateLabelStyle: LabelStyle {
  func makeBody(configuration: Configuration) -> some View {
    HStack(spacing: 6) {
      configuration.icon.foregroundStyle(.lbGreen).imageScale(.small)
      configuration.title
    }
  }
}

/// A card that dims and settles slightly while pressed.
struct ShelfPressStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .scaleEffect(configuration.isPressed ? 0.98 : 1)
      .opacity(configuration.isPressed ? 0.8 : 1)
      .animation(.easeOut(duration: 0.15), value: configuration.isPressed)
  }
}
