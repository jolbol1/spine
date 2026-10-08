import SwiftUI

/// The web's small-caps section heading ("DISC DETAILS", "CAST").
struct SectionLabel: View {
  let text: String

  init(_ text: String) { self.text = text }

  var body: some View {
    Text(text.uppercased())
      .font(.caption.weight(.semibold))
      .tracking(1.4)
      .foregroundStyle(.spineMutedForeground)
      .accessibilityAddTraits(.isHeader)
  }
}

/// Label on the left, value on the right — hidden when the value is empty.
struct MetaRow: View {
  let label: String
  let value: String?

  var body: some View {
    if let value, !value.isEmpty {
      HStack(alignment: .firstTextBaseline, spacing: 16) {
        Text(label.uppercased())
          .font(.caption.weight(.semibold))
          .tracking(1.2)
          .foregroundStyle(.spineMutedForeground)
        Spacer(minLength: 8)
        Text(value)
          .font(.subheadline)
          .foregroundStyle(.spineForeground)
          .multilineTextAlignment(.trailing)
          .textSelection(.enabled)
      }
      .padding(.vertical, 9)
      .accessibilityElement(children: .combine)
    }
  }
}

/// A rounded tag — genre, HDR, edition.
struct Tag: View {
  let text: String
  var fill: Color = .spineSecondary
  var foreground: Color = .spineForeground
  var systemImage: String? = nil

  var body: some View {
    HStack(spacing: 4) {
      if let systemImage { Image(systemName: systemImage).imageScale(.small) }
      Text(text)
    }
    .font(.caption.weight(.semibold))
    .foregroundStyle(foreground)
    .padding(.horizontal, 8)
    .padding(.vertical, 4)
    .background(fill, in: .capsule)
    .fixedSize()
  }
}

/// Initials in a circle — the account avatar and person placeholders.
struct InitialsAvatar: View {
  let name: String
  var size: CGFloat = 32

  var body: some View {
    Text(Self.initials(name))
      .font(.system(size: size * 0.38, weight: .bold))
      .foregroundStyle(.spineForeground)
      .frame(width: size, height: size)
      .background(.spineSecondary, in: .circle)
      .accessibilityHidden(true)
  }

  static func initials(_ name: String) -> String {
    name.split(separator: " ").prefix(2).compactMap(\.first).map(String.init).joined()
      .uppercased()
  }
}

/// A headshot from TMDB, or initials.
struct PersonAvatar: View {
  let name: String
  let url: URL?
  var size: CGFloat = 32

  var body: some View {
    RemoteImage(url: url, maxPixelSize: size * 3) {
      InitialsAvatar(name: name, size: size)
    }
    .frame(width: size, height: size)
    .clipShape(.circle)
    .accessibilityHidden(true)
  }
}

/// Full-screen loading state for a tab whose data hasn't arrived yet.
struct LoadingView: View {
  var body: some View {
    ProgressView()
      .controlSize(.large)
      .tint(.spineMutedForeground)
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .background(Color.spineBackground.ignoresSafeArea())
  }
}

/// A failed first load, with a retry.
struct LoadFailedView: View {
  let message: String
  let retry: () async -> Void

  var body: some View {
    ContentUnavailableView {
      Label("Couldn't load your collection", systemImage: "wifi.exclamationmark")
    } description: {
      Text(message)
    } actions: {
      Button {
        Task { await retry() }
      } label: {
        Text("Try again").foregroundStyle(.onAccent)
      }
      .buttonStyle(.glassProminent)
    }
    .background(Color.spineBackground.ignoresSafeArea())
  }
}

/// The account avatar for a tab's top-right corner — opens Settings, where
/// the account details and sign-out live (the web's avatar menu).
struct AccountButton: ToolbarContent {
  @Environment(AuthStore.self) private var auth
  @Environment(Router.self) private var router

  var body: some ToolbarContent {
    ToolbarItem(placement: .topBarTrailing) {
      Button {
        router.sheet = .settings
      } label: {
        if case .signedIn(let user) = auth.phase {
          InitialsAvatar(name: user.name, size: 30)
        } else {
          Image(systemName: "person.crop.circle")
        }
      }
      .accessibilityLabel("Account and settings")
    }
    .sharedBackgroundVisibility(.hidden)
  }
}
