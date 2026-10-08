import SwiftUI

/// Settings (src/routes/_app/settings.tsx) plus the web's avatar menu: the
/// account and sign-out, the Letterboxd username and syncs, and the
/// whole-collection backfills. Presented as a sheet.
struct SettingsView: View {
  @Environment(AuthStore.self) private var auth
  @Environment(Library.self) private var library
  @Environment(Toasts.self) private var toasts
  @Environment(\.dismiss) private var dismiss

  @State private var jobs = SettingsJobs.shared
  @State private var username = ""
  @State private var savingUsername = false
  @State private var confirmingSignOut = false
  @FocusState private var usernameFocused: Bool

  private var savedUsername: String? { library.settings?.letterboxdUsername }
  private var trimmedUsername: String { username.trimmingCharacters(in: .whitespaces) }
  /// The server's rule: letters, digits, underscores, hyphens; ≤ 100.
  private var usernameIsValid: Bool {
    trimmedUsername.count <= 100 && trimmedUsername.wholeMatch(of: /[a-zA-Z0-9_-]*/) != nil
  }
  private var usernameChanged: Bool { trimmedUsername != (savedUsername ?? "") }

  var body: some View {
    NavigationStack {
      Form {
        account
        letterboxd
        letterboxdSyncs
        tmdb
        rottenTomatoes
        criterion
        about
      }
      .formStyle(.grouped)
      .spineScreenBackground()
      .scrollDismissesKeyboard(.interactively)
      .navigationTitle("Settings")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .confirmationAction) {
          Button("Done") { dismiss() }
            .fontWeight(.semibold)
        }
      }
      .confirmationDialog(
        "Sign out of Spine?", isPresented: $confirmingSignOut, titleVisibility: .visible
      ) {
        Button("Sign Out", role: .destructive) {
          Task { await auth.signOut() }
        }
      } message: {
        Text("Your collection stays on your server. This device's offline copy is removed.")
      }
    }
    .presentationBackground(Color.spineBackground)
    .onAppear { username = savedUsername ?? "" }
    .onChange(of: savedUsername) { _, saved in
      if !usernameFocused { username = saved ?? "" }
    }
  }

  // MARK: Account

  @ViewBuilder private var account: some View {
    Section {
      if case .signedIn(let user) = auth.phase {
        HStack(spacing: 14) {
          InitialsAvatar(name: user.name, size: 48)
          VStack(alignment: .leading, spacing: 2) {
            Text(user.name)
              .font(.headline)
              .foregroundStyle(.spineForeground)
            Text(user.email)
              .font(.subheadline)
              .foregroundStyle(.spineMutedForeground)
              .textSelection(.enabled)
          }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
      }
      if !auth.lastServer.isEmpty {
        LabeledContent("Server") {
          Text(serverDisplay)
            .lineLimit(1)
            .truncationMode(.middle)
            .textSelection(.enabled)
        }
      }
      Button("Sign Out", role: .destructive) { confirmingSignOut = true }
    } header: {
      Text("Account")
    }
    .listRowBackground(Color.spineCard)
  }

  /// "localhost:3000" or "spine.example.com" — the scheme adds nothing.
  private var serverDisplay: String {
    guard let url = URL(string: auth.lastServer), let host = url.host() else {
      return auth.lastServer
    }
    let port = url.port.map { ":\($0)" } ?? ""
    return host + port + (url.path().count > 1 ? url.path() : "")
  }

  // MARK: Letterboxd

  @ViewBuilder private var letterboxd: some View {
    Section {
      HStack(spacing: 10) {
        LabeledContent("Username") {
          TextField("Username", text: $username, prompt: Text("e.g. davidehrlich"))
            .multilineTextAlignment(.trailing)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .textContentType(.username)
            .submitLabel(.done)
            .focused($usernameFocused)
            .onSubmit(saveUsername)
        }
        if savingUsername {
          ProgressView()
        } else if usernameChanged {
          Button(action: saveUsername) {
            Text("Save").foregroundStyle(.onAccent)
          }
          .buttonStyle(.glassProminent)
          .controlSize(.small)
          .fontWeight(.semibold)
            .disabled(!usernameIsValid)
            .transition(.scale.combined(with: .opacity))
        }
      }
      .animation(.snappy, value: usernameChanged)
    } header: {
      Text("Letterboxd sync")
    } footer: {
      VStack(alignment: .leading, spacing: 8) {
        if !usernameIsValid {
          Label(
            "Invalid Letterboxd username — use letters, numbers, _ and -.",
            systemImage: "exclamationmark.circle.fill"
          )
          .foregroundStyle(.spineDestructive)
        }
        Text("letterboxd.com/**\(trimmedUsername.isEmpty ? "username" : trimmedUsername)**/rss")
          .monospaced()
        Text(
          "Watched state is pulled from your public Letterboxd RSS feed. First-time watches only — rewatches are ignored. You can pin any title manually from its detail page."
        )
      }
    }
    .listRowBackground(Color.spineCard)
  }

  @ViewBuilder private var letterboxdSyncs: some View {
    let user = savedUsername ?? "username"
    Section {
      SettingsJobRow(
        title: "Sync now", systemImage: "arrow.triangle.2.circlepath",
        detail: lastSyncedText,
        started: jobs.startDate(of: .letterboxd, for: library),
        disabled: savedUsername == nil
      ) { run(.letterboxd) }
      SettingsJobRow(
        title: "Sync full history", systemImage: "clock.arrow.circlepath",
        detail:
          "The feed only covers recent entries. Sync your **full diary** from letterboxd.com/\(user)/diary — first watch dates, your ratings, and review links for everything you've ever logged.",
        started: jobs.startDate(of: .letterboxdHistory, for: library),
        disabled: savedUsername == nil
      ) { run(.letterboxdHistory) }
    } footer: {
      if savedUsername == nil {
        Text("Save your Letterboxd username to sync.")
      }
    }
    .listRowBackground(Color.spineCard)
  }

  private var lastSyncedText: String {
    guard let last = library.settings?.lastLetterboxdSyncAt else { return "Never synced" }
    return "Last synced \(last.formatted(date: .abbreviated, time: .shortened))"
  }

  // MARK: Backfills

  private var tmdb: some View {
    Section {
      SettingsJobRow(
        title: "Fetch missing cast", systemImage: "person.2",
        detail: "Requires `TMDB_API_KEY` in `.env`.",
        started: jobs.startDate(of: .tmdbCast, for: library)
      ) { run(.tmdbCast) }
      SettingsJobRow(
        title: "Fetch missing details", systemImage: "info.circle",
        detail:
          "Genres, production companies, countries, budget & box office, franchise, and the film's IMDb id.",
        started: jobs.startDate(of: .tmdbDetails, for: library)
      ) { run(.tmdbDetails) }
    } header: {
      Text("TMDB data")
    } footer: {
      Text(
        "Cast and title details (genres, studios, countries, box office, IMDb links) are fetched automatically from TMDB when you add a film. Run the backfills for films added before TMDB was configured — they power the people pages and most stats."
      )
    }
    .listRowBackground(Color.spineCard)
  }

  private var rottenTomatoes: some View {
    Section {
      SettingsJobRow(
        title: "Fetch missing scores", systemImage: "chart.bar",
        detail: "Roughly a second per film — large collections take a while.",
        started: jobs.startDate(of: .rottenTomatoes, for: library)
      ) { run(.rottenTomatoes) }
    } header: {
      Text("Rotten Tomatoes scores")
    } footer: {
      Text(
        "Critic and audience scores are scraped from rottentomatoes.com (there's no public API) when you add a film. Run a backfill for the rest — titles that don't match are skipped on later runs, but each film page has a refresh button to retry one."
      )
    }
    .listRowBackground(Color.spineCard)
  }

  private var criterion: some View {
    Section {
      SettingsJobRow(
        title: "Fetch missing spines", systemImage: "number",
        detail: "Applies to films whose publisher contains \"Criterion\".",
        started: jobs.startDate(of: .criterionSpines, for: library)
      ) { run(.criterionSpines) }
    } header: {
      Text("Criterion spine numbers")
    } footer: {
      Text(
        "Spine numbers come from criterion.com's release list and are filled automatically when you add a film with a Criterion label. Run a backfill for titles added before, or after new releases."
      )
    }
    .listRowBackground(Color.spineCard)
  }

  // MARK: About

  private var about: some View {
    Section {
      LabeledContent("Version", value: appVersion)
    } header: {
      Text("About")
    } footer: {
      VStack(spacing: 10) {
        SpineBrand(markHeight: 22)
        Text("Spine — your physical media, catalogued.")
          .font(.footnote)
      }
      .frame(maxWidth: .infinity)
      .padding(.top, 24)
    }
    .listRowBackground(Color.spineCard)
  }

  private var appVersion: String {
    let info = Bundle.main.infoDictionary
    let version = info?["CFBundleShortVersionString"] as? String ?? "—"
    let build = info?["CFBundleVersion"] as? String
    return build.map { "\(version) (\($0))" } ?? version
  }

  // MARK: Actions

  private func run(_ job: SettingsJobs.Job) {
    jobs.run(job, library: library, toasts: toasts)
  }

  private func saveUsername() {
    guard usernameIsValid, usernameChanged, !savingUsername else { return }
    usernameFocused = false
    savingUsername = true
    Task {
      defer { savingUsername = false }
      do {
        try await library.saveLetterboxdUsername(trimmedUsername)
        username = library.settings?.letterboxdUsername ?? ""
        toasts.success("Settings saved")
      } catch is CancellationError {
      } catch APIError.unauthorized {
      } catch APIError.transport(let message) {
        toasts.error(message)
      } catch {
        toasts.error("Could not save settings")
      }
    }
  }
}

/// A sync or backfill: what it does, and — while it runs, which can take
/// minutes — a live elapsed time and a spinner in place of the chevron.
private struct SettingsJobRow: View {
  let title: String
  let systemImage: String
  let detail: LocalizedStringKey
  let started: Date?
  var disabled = false
  let action: () -> Void

  init(
    title: String, systemImage: String, detail: String, started: Date?,
    disabled: Bool = false, action: @escaping () -> Void
  ) {
    self.title = title
    self.systemImage = systemImage
    self.detail = LocalizedStringKey(detail)
    self.started = started
    self.disabled = disabled
    self.action = action
  }

  var body: some View {
    Button(action: action) {
      HStack(alignment: .center, spacing: 12) {
        VStack(alignment: .leading, spacing: 4) {
          Label(title, systemImage: systemImage)
            .font(.body.weight(.medium))
            .foregroundStyle(isEnabled ? Color.lbGreen : Color.spineMutedForeground)
          Text(detail)
            .font(.footnote)
            .foregroundStyle(.spineMutedForeground)
            .fixedSize(horizontal: false, vertical: true)
        }
        Spacer(minLength: 8)
        if let started {
          HStack(spacing: 8) {
            Text(started, style: .timer)
              .font(.footnote.monospacedDigit())
              .foregroundStyle(.lbOrange)
            ProgressView()
          }
          .transition(.opacity)
        }
      }
      .padding(.vertical, 4)
      .contentShape(.rect)
    }
    .buttonStyle(.plain)
    .disabled(!isEnabled)
    .animation(.default, value: started)
    .accessibilityValue(started == nil ? "" : "Running")
  }

  private var isEnabled: Bool { !disabled && started == nil }
}
