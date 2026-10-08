import Observation
import SwiftUI
import UIKit

/// Transient confirmations and errors, shown as a glass capsule over the top
/// of the app — the web's sonner toasts. Errors from the API layer carry the
/// server's message, so `show(error)` is usually all a screen needs.
@Observable
final class Toasts {
  struct Toast: Identifiable, Equatable {
    enum Kind { case success, error, info }
    let id = UUID()
    let kind: Kind
    let message: String
  }

  private(set) var current: Toast?
  private var dismissal: Task<Void, Never>?

  func success(_ message: String) { show(Toast(kind: .success, message: message)) }
  func info(_ message: String) { show(Toast(kind: .info, message: message)) }
  func error(_ message: String) { show(Toast(kind: .error, message: message)) }

  /// Show an error thrown by the API layer. Cancellations are ignored, and an
  /// expired session is handled by signing out, not by a toast.
  func error(_ error: Error) {
    if error is CancellationError { return }
    if let apiError = error as? APIError, apiError == .unauthorized { return }
    show(Toast(kind: .error, message: error.userMessage))
  }

  func dismiss() {
    dismissal?.cancel()
    current = nil
  }

  private func show(_ toast: Toast) {
    dismissal?.cancel()
    current = toast
    let seconds: Double = toast.kind == .error ? 5 : 3.5
    dismissal = Task {
      try? await Task.sleep(for: .seconds(seconds))
      guard !Task.isCancelled else { return }
      if current?.id == toast.id { current = nil }
    }
  }
}

/// Shows toasts in a window of their own above every sheet and alert — an
/// overlay on the root view would sit under any presented sheet. The window
/// takes no touches, so it never blocks the app; toasts dismiss on a timer
/// and are announced to VoiceOver.
struct ToastOverlay: ViewModifier {
  @Environment(Toasts.self) private var toasts

  func body(content: Content) -> some View {
    content.background {
      ToastWindowInstaller { scene in ToastWindow.install(in: scene, toasts: toasts) }
        .frame(width: 0, height: 0)
        .accessibilityHidden(true)
    }
  }
}

/// One toast window per scene, however many views ask for it.
private enum ToastWindow {
  private static var windows: [ObjectIdentifier: UIWindow] = [:]

  static func install(in scene: UIWindowScene, toasts: Toasts) {
    let key = ObjectIdentifier(scene)
    guard windows[key] == nil else { return }
    let host = UIHostingController(
      rootView: ToastHost().environment(toasts).preferredColorScheme(.dark))
    host.view.backgroundColor = .clear
    let window = UIWindow(windowScene: scene)
    window.windowLevel = .alert + 1
    window.backgroundColor = .clear
    window.isUserInteractionEnabled = false
    window.overrideUserInterfaceStyle = .dark
    window.rootViewController = host
    window.isHidden = false
    windows[key] = window
  }
}

/// Reports the window scene its view lands in.
private struct ToastWindowInstaller: UIViewRepresentable {
  let onScene: (UIWindowScene) -> Void

  func makeUIView(context: Context) -> SceneProbeView {
    let view = SceneProbeView()
    view.onScene = onScene
    return view
  }

  func updateUIView(_ view: SceneProbeView, context: Context) {}

  final class SceneProbeView: UIView {
    var onScene: ((UIWindowScene) -> Void)?

    override func didMoveToWindow() {
      super.didMoveToWindow()
      if let scene = window?.windowScene { onScene?(scene) }
    }
  }
}

private struct ToastHost: View {
  @Environment(Toasts.self) private var toasts

  var body: some View {
    Color.clear
      .overlay(alignment: .top) {
        if let toast = toasts.current {
          ToastView(toast: toast)
            .padding(.horizontal, 16)
            .padding(.top, 4)
            .transition(.move(edge: .top).combined(with: .opacity))
            .id(toast.id)
        }
      }
      .animation(.spring(duration: 0.35), value: toasts.current)
      .sensoryFeedback(trigger: toasts.current) { _, new in
        switch new?.kind {
        case .success?: .success
        case .error?: .error
        default: nil
        }
      }
      .onChange(of: toasts.current) { _, new in
        if let new {
          UIAccessibility.post(notification: .announcement, argument: new.message)
        }
      }
  }
}

private struct ToastView: View {
  let toast: Toasts.Toast

  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: 10) {
      Image(systemName: symbol)
        .foregroundStyle(tint)
        .font(.subheadline.weight(.semibold))
      Text(toast.message)
        .font(.subheadline.weight(.medium))
        .foregroundStyle(.spineForeground)
        .multilineTextAlignment(.leading)
        .fixedSize(horizontal: false, vertical: true)
    }
    .padding(.horizontal, 16)
    .padding(.vertical, 12)
    .frame(maxWidth: 520)
    .glassEffect(.regular, in: .capsule)
    .accessibilityElement(children: .combine)
    .accessibilityAddTraits(.isStaticText)
  }

  private var symbol: String {
    switch toast.kind {
    case .success: "checkmark.circle.fill"
    case .error: "exclamationmark.triangle.fill"
    case .info: "info.circle.fill"
    }
  }

  private var tint: Color {
    switch toast.kind {
    case .success: .lbGreen
    case .error: .spineDestructive
    case .info: .lbBlue
    }
  }
}

extension View {
  /// Hosts the app-wide toast above everything, sheets included. Apply at
  /// the root; applying it again elsewhere is harmless.
  func toastOverlay() -> some View { modifier(ToastOverlay()) }
}
