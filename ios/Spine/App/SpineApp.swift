import SwiftUI

@main
struct SpineApp: App {
  @State private var auth = AuthStore()
  @State private var toasts = Toasts()

  var body: some Scene {
    WindowGroup {
      RootView()
        .toastOverlay()
        .environment(auth)
        .environment(toasts)
        .tint(.lbGreen)
        .preferredColorScheme(.dark)
    }
  }
}

/// Signed in or not: the tabs, the sign-in screen, or a launch screen while
/// a stored session is checked.
struct RootView: View {
  @Environment(AuthStore.self) private var auth

  var body: some View {
    Group {
      switch auth.phase {
      case .restoring:
        LaunchView()
      case .signedOut:
        SignInView()
      case .signedIn:
        if let library = auth.library {
          MainTabView()
            .environment(library)
            // A new account gets fresh tab state.
            .id(library.userID)
        }
      }
    }
    .animation(.default, value: auth.phase)
    .task { await auth.restore() }
  }
}

private struct LaunchView: View {
  var body: some View {
    SpineMark()
      .frame(height: 72)
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .background(Color.spineBackground.ignoresSafeArea())
  }
}
