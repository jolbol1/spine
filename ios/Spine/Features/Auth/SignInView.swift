import SwiftUI

/// Sign in or create an account on a self-hosted Spine server — the same
/// accounts the web uses (src/routes/login.tsx, signup.tsx).
struct SignInView: View {
  @Environment(AuthStore.self) private var auth

  private enum Mode: Hashable { case signIn, signUp }
  private enum Field: Hashable { case server, name, email, password }

  @State private var mode = Mode.signIn
  @State private var server = ""
  @State private var name = ""
  @State private var email = ""
  @State private var password = ""
  @State private var pending = false
  @State private var error: String?
  @FocusState private var focus: Field?

  var body: some View {
    ScrollView {
      VStack(spacing: 28) {
        header

        Picker("Mode", selection: $mode) {
          Text("Sign in").tag(Mode.signIn)
          Text("Create account").tag(Mode.signUp)
        }
        .pickerStyle(.segmented)
        .labelsHidden()
        .accessibilityIdentifier("auth.mode")

        VStack(alignment: .leading, spacing: 8) {
          fields
          Text("Your Spine server's address — the one you open on the web.")
            .font(.footnote)
            .foregroundStyle(.spineMutedForeground)
            .padding(.horizontal, 4)
        }

        if let message = error ?? auth.notice {
          Label(message, systemImage: "exclamationmark.triangle.fill")
            .accessibilityIdentifier("auth.error")
            .font(.subheadline)
            .foregroundStyle(error == nil ? .lbOrange : .spineDestructive)
            .frame(maxWidth: .infinity, alignment: .leading)
            .transition(.opacity)
        }

        Button(action: submit) {
          HStack(spacing: 8) {
            if pending { ProgressView().tint(.onAccent) }
            Text(buttonTitle).fontWeight(.semibold)
          }
          .foregroundStyle(.onAccent)
          .frame(maxWidth: .infinity)
        }
        .buttonStyle(.glassProminent)
        .controlSize(.large)
        .disabled(pending || !canSubmit)
        .accessibilityIdentifier("auth.submit")
      }
      .padding(.horizontal, 24)
      .padding(.vertical, 40)
      .frame(maxWidth: 440)
      .frame(maxWidth: .infinity)
    }
    .scrollDismissesKeyboard(.interactively)
    .background(Color.spineBackground.ignoresSafeArea())
    .animation(.default, value: mode)
    .animation(.default, value: error)
    .onAppear {
      if server.isEmpty { server = auth.lastServer }
    }
    .onChange(of: mode) { error = nil }
  }

  private var header: some View {
    VStack(spacing: 14) {
      SpineMark().frame(height: 84)
      Text("SPINE")
        .font(.system(size: 30, weight: .heavy))
        .tracking(6)
        .foregroundStyle(.spineForeground)
      Text("Your physical media, catalogued.")
        .font(.subheadline)
        .foregroundStyle(.spineMutedForeground)
    }
    .accessibilityElement(children: .combine)
    .padding(.top, 12)
  }

  private var fields: some View {
    VStack(spacing: 0) {
      TextField("Server", text: $server, prompt: Text("spine.example.com"))
        .keyboardType(.URL)
        .textContentType(.URL)
        .textInputAutocapitalization(.never)
        .autocorrectionDisabled()
        .focused($focus, equals: .server)
        .accessibilityIdentifier("auth.server")
        .submitLabel(.next)
        .onSubmit { focus = mode == .signUp ? .name : .email }
        .fieldRow(systemImage: "server.rack")

      if mode == .signUp {
        Divider().overlay(.spineBorder)
        TextField("Name", text: $name)
          .textContentType(.name)
          .focused($focus, equals: .name)
        .accessibilityIdentifier("auth.name")
          .submitLabel(.next)
          .onSubmit { focus = .email }
          .fieldRow(systemImage: "person")
      }

      Divider().overlay(.spineBorder)
      TextField("Email", text: $email)
        .keyboardType(.emailAddress)
        .textContentType(.username)
        .textInputAutocapitalization(.never)
        .autocorrectionDisabled()
        .focused($focus, equals: .email)
        .accessibilityIdentifier("auth.email")
        .submitLabel(.next)
        .onSubmit { focus = .password }
        .fieldRow(systemImage: "envelope")

      Divider().overlay(.spineBorder)
      SecureField(
        "Password", text: $password,
        prompt: Text(mode == .signUp ? "At least 8 characters" : "Password")
      )
      .textContentType(mode == .signUp ? .newPassword : .password)
      .focused($focus, equals: .password)
        .accessibilityIdentifier("auth.password")
      .submitLabel(.go)
      .onSubmit(submit)
      .fieldRow(systemImage: "lock")
    }
    .background(.spineCard, in: .rect(cornerRadius: 14))
    .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(.spineBorder))
  }

  private var buttonTitle: String {
    switch (mode, pending) {
    case (.signIn, false): "Sign in"
    case (.signIn, true): "Signing in…"
    case (.signUp, false): "Create account"
    case (.signUp, true): "Creating account…"
    }
  }

  private var canSubmit: Bool {
    !server.trimmingCharacters(in: .whitespaces).isEmpty
      && !email.trimmingCharacters(in: .whitespaces).isEmpty
      && !password.isEmpty
      && (mode == .signIn || !name.trimmingCharacters(in: .whitespaces).isEmpty)
  }

  private func submit() {
    guard canSubmit, !pending else { return }
    if mode == .signUp && password.count < 8 {
      error = "Use a password of at least 8 characters."
      return
    }
    focus = nil
    error = nil
    pending = true
    Task {
      defer { pending = false }
      do {
        switch mode {
        case .signIn:
          try await auth.signIn(server: server, email: email, password: password)
        case .signUp:
          try await auth.signUp(server: server, name: name, email: email, password: password)
        }
      } catch {
        self.error = error.userMessage
      }
    }
  }
}

private extension View {
  func fieldRow(systemImage: String) -> some View {
    HStack(spacing: 12) {
      Image(systemName: systemImage)
        .foregroundStyle(.spineMutedForeground)
        .frame(width: 20)
        .accessibilityHidden(true)
      self
    }
    .padding(.horizontal, 16)
    .frame(minHeight: 52)
  }
}

#Preview {
  SignInView()
    .environment(AuthStore())
    .preferredColorScheme(.dark)
}
