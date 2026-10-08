import SwiftUI

/// The Oracle tab (src/routes/_app/oracle.tsx): can't decide what to watch?
/// Set how much time you have, and it picks from your own shelf — after a
/// short flicker through the candidates.
struct OracleView: View {
  @Environment(Library.self) private var library
  @Environment(Router.self) private var router
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  @State private var unwatchedOnly = true
  @State private var format = OracleFilter.anyFormat
  @State private var timeLimit = OracleFilter.anyLength

  @State private var pick: Film?
  @State private var flicker: Film?
  @State private var spinning = false
  @State private var spin: Task<Void, Never>?
  /// Bumped per flicker frame and per reveal, to drive the haptics.
  @State private var tick = 0
  @State private var reveals = 0
  /// The chosen film's cover, fetched while the frames flicker so the
  /// reveal never blinks through a placeholder.
  @State private var chosenCover: (filmID: String, image: UIImage)?

  var body: some View {
    NavigationStack(path: router.path(for: .oracle)) {
      content
        .navigationTitle("Oracle")
        .toolbarTitleDisplayMode(.inline)
        .toolbar {
          ToolbarItem(placement: .principal) {
            Text("THE ORACLE")
              .font(.caption.weight(.bold))
              .tracking(3)
              .foregroundStyle(.lbOrange)
              .accessibilityAddTraits(.isHeader)
          }
          AccountButton()
        }
        .routeDestinations()
    }
  }

  @ViewBuilder private var content: some View {
    if !library.hasLoadedFilms {
      if let error = library.loadError {
        LoadFailedView(message: error) { await library.refreshAll() }
      } else {
        LoadingView()
      }
    } else if library.films.isEmpty {
      ContentUnavailableView {
        Label("The Oracle sees nothing", systemImage: "sparkles")
      } description: {
        Text("Add films to your collection and the Oracle will choose among them.")
      } actions: {
        Button {
          router.sheet = .addFilm(scan: false)
        } label: {
          Label("Add a film", systemImage: "plus").foregroundStyle(.onAccent)
        }
        .buttonStyle(.glassProminent)
        .tint(.lbOrange)
      }
      .spineScreenBackground()
    } else {
      oracle
    }
  }

  private var candidates: [Film] {
    OracleFilter.candidates(
      in: library.films, unwatchedOnly: unwatchedOnly, format: format, timeLimit: timeLimit)
  }

  private var shown: Film? { flicker ?? pick }

  private var oracle: some View {
    let candidates = candidates
    return ScrollView {
      VStack(spacing: 24) {
        header

        VStack(spacing: 18) {
          stage
          if candidates.isEmpty && !spinning {
            Text(
              "Nothing fits these constraints — loosen the runtime limit or include watched films."
            )
            .font(.subheadline)
            .foregroundStyle(.spineForeground)
            .multilineTextAlignment(.center)
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .frame(maxWidth: 360)
            .background(.spineCard, in: .rect(cornerRadius: 14))
            .transition(.opacity)
          }
          if let pick, !spinning {
            OracleVerdict(film: pick)
              .transition(.opacity.combined(with: .offset(y: 8)))
          }
        }
        .animation(.default, value: candidates.isEmpty)
      }
      .padding(.horizontal, 20)
      .padding(.vertical, 8)
      .frame(maxWidth: 560)
      .frame(maxWidth: .infinity)
    }
    .scrollBounceBehavior(.basedOnSize)
    .defaultScrollAnchor(.center, for: .alignment)
    .spineScreenBackground()
    .safeAreaBar(edge: .bottom) { dock(candidates) }
    .sensoryFeedback(.impact(weight: .light), trigger: tick)
    .sensoryFeedback(.success, trigger: reveals)
  }

  /// The controls, in thumb reach: filters, how many films qualify, and
  /// the big button.
  private func dock(_ candidates: [Film]) -> some View {
    VStack(spacing: 10) {
      filters
      Text(countText(candidates.count))
        .font(.caption)
        .foregroundStyle(.spineMutedForeground)
        .multilineTextAlignment(.center)
        .contentTransition(.numericText())
        .animation(.snappy, value: candidates.count)
      consultButton(enabled: !spinning && !candidates.isEmpty) { consult(candidates) }
        .padding(.top, 2)
    }
    .padding(.horizontal, 20)
    .padding(.top, 8)
    .padding(.bottom, 10)
    .frame(maxWidth: 560)
    .frame(maxWidth: .infinity)
  }

  // MARK: Pieces

  private var header: some View {
    VStack(spacing: 8) {
      Text("Can't decide? Don't.")
        .font(.largeTitle.bold())
        .foregroundStyle(.spineForeground)
        .multilineTextAlignment(.center)
      Text("Tell the Oracle how much time you have. It answers from your own shelf.")
        .font(.subheadline)
        .foregroundStyle(.spineMutedForeground)
        .multilineTextAlignment(.center)
    }
  }

  /// The poster: a sealed card before the first reading, flickering frames
  /// while it decides, then the chosen film — which opens it.
  @ViewBuilder private var stage: some View {
    let poster = OracleStagePoster(
      film: shown, settled: !spinning && pick != nil,
      cover: chosenCover.flatMap { $0.filmID == pick?.id ? $0.image : nil }
    )
    // Half the visible height, so the verdict fits beneath it.
    .containerRelativeFrame(.vertical) { length, _ in min(max(length * 0.5, 200), 380) }
    .scaleEffect(spinning ? 0.95 : 1)
    .animation(reduceMotion ? nil : .spring(duration: 0.5, bounce: 0.4), value: spinning)
    if let pick, !spinning {
      NavigationLink(value: Route.film(id: pick.id)) { poster }
        .buttonStyle(.plain)
        .accessibilityLabel("\(pick.title), the Oracle's choice")
        .accessibilityHint("Opens the film")
    } else {
      poster
        .accessibilityHidden(spinning)
    }
  }

  private var filters: some View {
    GlassEffectContainer(spacing: 8) {
      OracleFlowLayout(spacing: 8) {
        Toggle(isOn: $unwatchedOnly) {
          Label("Unwatched only", systemImage: unwatchedOnly ? "eye.slash.fill" : "eye.slash")
        }
        .toggleStyle(OracleChipToggleStyle())

        Menu {
          Picker("Format", selection: $format) {
            Text("Any format").tag(OracleFilter.anyFormat)
            ForEach(FilmVocabulary.formats, id: \.self) { Text($0).tag($0) }
          }
        } label: {
          OracleChip(
            title: format == OracleFilter.anyFormat ? "Any format" : format,
            systemImage: "opticaldisc", active: format != OracleFilter.anyFormat)
        }
        .accessibilityLabel("Format")
        .accessibilityValue(format == OracleFilter.anyFormat ? "Any format" : format)

        Menu {
          Picker("Time", selection: $timeLimit) {
            ForEach(OracleFilter.timeOptions, id: \.value) { option in
              Text(option.label).tag(option.value)
            }
          }
        } label: {
          OracleChip(
            title: OracleFilter.timeLabel(timeLimit), systemImage: "clock",
            active: timeLimit != OracleFilter.anyLength)
        }
        .accessibilityLabel("How much time do you have")
        .accessibilityValue(OracleFilter.timeLabel(timeLimit))
      }
    }
    .disabled(spinning)
  }

  private func consultButton(enabled: Bool, action: @escaping () -> Void) -> some View {
    Button(action: action) {
      Label(
        spinning ? "Consulting…" : pick != nil ? "Consult again" : "Consult the Oracle",
        systemImage: "sparkles"
      )
      .font(.headline)
      .foregroundStyle(enabled || spinning ? Color(hex: 0x1B0E00) : Color.spineMutedForeground)
      .symbolEffect(.bounce, value: reveals)
      .frame(maxWidth: 360)
      .padding(.vertical, 4)
      .contentTransition(.opacity)
    }
    .buttonStyle(.glassProminent)
    .tint(.lbOrange)
    .controlSize(.extraLarge)
    // Stays lit while the Oracle thinks; it just ignores taps.
    .disabled(!enabled && !spinning)
    .allowsHitTesting(!spinning)
  }

  private func countText(_ count: Int) -> String {
    "\(count) film\(count == 1 ? "" : "s") fit the bill"
      + (timeLimit != OracleFilter.anyLength
        ? " (films without a recorded runtime are left out)" : "")
  }

  // MARK: Consulting

  /// 14 ticks of 110 ms through random candidates, then a final random
  /// pick — the web's timing.
  private func consult(_ pool: [Film]) {
    guard !spinning, let chosen = pool.randomElement() else { return }
    let frames = (0..<13).compactMap { _ in pool.randomElement() }
    OracleStagePoster.prefetch(frames)
    chosenCover = nil
    if let url = chosen.coverURL {
      Task {
        if let image = await ImageCache.shared.image(
          for: url, maxPixelSize: OracleStagePoster.pixelSize)
        {
          chosenCover = (chosen.id, image)
        }
      }
    }

    spin?.cancel()
    withAnimation(.easeOut(duration: 0.2)) {
      pick = nil
      spinning = true
    }
    spin = Task {
      for frame in frames {
        try? await Task.sleep(for: .milliseconds(110))
        guard !Task.isCancelled else { return }
        flicker = frame
        tick += 1
      }
      try? await Task.sleep(for: .milliseconds(110))
      guard !Task.isCancelled else { return }
      withAnimation(reduceMotion ? .default : .spring(duration: 0.55, bounce: 0.35)) {
        flicker = nil
        pick = chosen
        spinning = false
      }
      reveals += 1
      AccessibilityNotification.Announcement(
        "The Oracle has spoken: \(chosen.title)"
      ).post()
    }
  }
}

// MARK: - Filters

/// The web's filter values and the candidate rule.
private enum OracleFilter {
  static let anyFormat = "any"
  static let anyLength = "any"

  /// "How much time do I have" — minutes, or "any".
  static let timeOptions: [(value: String, label: String)] = [
    ("any", "Any length"),
    ("90", "≤ 1h 30m"),
    ("105", "≤ 1h 45m"),
    ("120", "≤ 2h"),
    ("150", "≤ 2h 30m"),
    ("180", "≤ 3h"),
    ("240", "≤ 4h"),
  ]

  static func timeLabel(_ value: String) -> String {
    timeOptions.first { $0.value == value }?.label ?? "Any length"
  }

  static func candidates(
    in films: [Film], unwatchedOnly: Bool, format: String, timeLimit: String
  ) -> [Film] {
    var list = films
    if unwatchedOnly { list = list.filter { !$0.isWatched } }
    if format != anyFormat { list = list.filter { $0.format == format } }
    if let limit = Int(timeLimit) {
      // Only films with a known runtime at or under the limit qualify.
      list = list.filter { ($0.runtimeMinutes ?? .max) <= limit }
    }
    return list
  }
}

/// A filter as a glass capsule; orange-tinted when it narrows the pool.
private struct OracleChip: View {
  let title: String
  let systemImage: String
  let active: Bool

  var body: some View {
    HStack(spacing: 5) {
      Image(systemName: systemImage)
        .foregroundStyle(active ? Color.lbOrange : Color.spineMutedForeground)
      Text(title)
        .foregroundStyle(.spineForeground)
    }
    .font(.footnote.weight(.semibold))
    .padding(.horizontal, 12)
    .padding(.vertical, 9)
    .glassEffect(
      active ? .regular.tint(.lbOrange.opacity(0.22)).interactive() : .regular.interactive(),
      in: .capsule
    )
    .contentShape(.capsule)
  }
}

private struct OracleChipToggleStyle: ToggleStyle {
  func makeBody(configuration: Configuration) -> some View {
    Button {
      configuration.isOn.toggle()
    } label: {
      HStack(spacing: 6) {
        configuration.label
          .labelStyle(OracleChipLabelStyle(active: configuration.isOn))
      }
      .font(.footnote.weight(.semibold))
      .padding(.horizontal, 12)
      .padding(.vertical, 9)
      .glassEffect(
        configuration.isOn
          ? .regular.tint(.lbOrange.opacity(0.22)).interactive() : .regular.interactive(),
        in: .capsule
      )
      .contentShape(.capsule)
    }
    .buttonStyle(.plain)
    .animation(.snappy, value: configuration.isOn)
    .accessibilityAddTraits(configuration.isOn ? .isSelected : [])
    .accessibilityValue(configuration.isOn ? "On" : "Off")
  }
}

private struct OracleChipLabelStyle: LabelStyle {
  let active: Bool

  func makeBody(configuration: Configuration) -> some View {
    HStack(spacing: 5) {
      configuration.icon
        .foregroundStyle(active ? Color.lbOrange : Color.spineMutedForeground)
      configuration.title
        .foregroundStyle(.spineForeground)
    }
  }
}

/// Centred, wrapping rows — the web's `flex-wrap justify-center`.
private struct OracleFlowLayout: Layout {
  var spacing: CGFloat = 8

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    let rows = rows(for: subviews, width: proposal.width ?? .infinity)
    let height = rows.map(\.height).reduce(0, +) + spacing * CGFloat(max(rows.count - 1, 0))
    let width = rows.map(\.width).max() ?? 0
    return CGSize(width: proposal.width ?? width, height: height)
  }

  func placeSubviews(
    in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()
  ) {
    var y = bounds.minY
    for row in rows(for: subviews, width: bounds.width) {
      var x = bounds.minX + (bounds.width - row.width) / 2
      for index in row.indices {
        let size = subviews[index].sizeThatFits(.unspecified)
        subviews[index].place(
          at: CGPoint(x: x, y: y + (row.height - size.height) / 2),
          proposal: ProposedViewSize(size))
        x += size.width + spacing
      }
      y += row.height + spacing
    }
  }

  private struct Row {
    var indices: [Int] = []
    var width: CGFloat = 0
    var height: CGFloat = 0
  }

  private func rows(for subviews: Subviews, width: CGFloat) -> [Row] {
    var rows: [Row] = []
    var current = Row()
    for index in subviews.indices {
      let size = subviews[index].sizeThatFits(.unspecified)
      let needed = current.indices.isEmpty ? size.width : current.width + spacing + size.width
      if needed > width, !current.indices.isEmpty {
        rows.append(current)
        current = Row()
      }
      current.width = current.indices.isEmpty ? size.width : current.width + spacing + size.width
      current.height = max(current.height, size.height)
      current.indices.append(index)
    }
    if !current.indices.isEmpty { rows.append(current) }
    return rows
  }
}

// MARK: - Stage

/// The Oracle's poster. Between flicker frames it keeps showing the last
/// loaded cover rather than blinking to a placeholder; once settled it only
/// ever shows the chosen film's own cover (or its title, while that loads).
private struct OracleStagePoster: View {
  let film: Film?
  let settled: Bool
  /// The settled film's cover, when it's already in hand.
  var cover: UIImage?

  @State private var image: UIImage?
  @State private var imageFilmID: String?

  static let pixelSize: CGFloat = 640
  private let radius: CGFloat = 12

  /// Warm the image cache with the frames about to flicker past.
  static func prefetch(_ films: [Film]) {
    var seen = Set<String>()
    for film in films where seen.insert(film.id).inserted {
      guard let url = film.coverURL else { continue }
      Task { _ = await ImageCache.shared.image(for: url, maxPixelSize: pixelSize) }
    }
  }

  var body: some View {
    Color.spineCard
      .aspectRatio(2 / 3, contentMode: .fit)
      .overlay {
        if let film {
          if settled, let cover {
            Image(uiImage: cover)
              .resizable()
              .scaledToFill()
          } else if let image, imageFilmID == film.id || !settled {
            Image(uiImage: image)
              .resizable()
              .scaledToFill()
          } else {
            titleCard(film.title)
          }
        } else {
          sealed
        }
      }
      .clipShape(.rect(cornerRadius: radius))
      .overlay {
        RoundedRectangle(cornerRadius: radius)
          .strokeBorder(settled ? Color.lbOrange : Color.spineBorder, lineWidth: settled ? 2 : 1)
      }
      .opacity(film != nil && !settled ? 0.72 : 1)
      .shadow(
        color: settled ? Color.lbOrange.opacity(0.35) : .black.opacity(0.35),
        radius: settled ? 28 : 14, y: 10
      )
      .task(id: film?.id) { await load() }
  }

  private func load() async {
    guard let film else {
      image = nil
      imageFilmID = nil
      return
    }
    guard let url = film.coverURL else {
      image = nil
      imageFilmID = film.id
      return
    }
    if let loaded = await ImageCache.shared.image(for: url, maxPixelSize: Self.pixelSize) {
      image = loaded
      imageFilmID = film.id
    } else if self.film?.id == film.id {
      image = nil
      imageFilmID = film.id
    }
  }

  private func titleCard(_ title: String) -> some View {
    ZStack {
      Color.spineSecondary
      Text(title.uppercased())
        .font(.system(size: 15, weight: .semibold))
        .tracking(0.8)
        .multilineTextAlignment(.center)
        .foregroundStyle(.spineMutedForeground)
        .padding(16)
    }
  }

  /// Before the first reading: a face-down card.
  private var sealed: some View {
    ZStack {
      RadialGradient(
        colors: [Color.lbOrange.opacity(0.22), Color.spineCard],
        center: .center, startRadius: 4, endRadius: 170)
      VStack(spacing: 14) {
        Image(systemName: "sparkles")
          .font(.system(size: 46, weight: .light))
          .foregroundStyle(.lbOrange)
          .symbolEffect(.breathe, options: .repeat(.continuous))
        Text("Your film awaits")
          .font(.caption.weight(.semibold))
          .tracking(1.2)
          .textCase(.uppercase)
          .multilineTextAlignment(.center)
          .foregroundStyle(.spineMutedForeground)
          .padding(.horizontal, 12)
      }
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("No film chosen yet")
  }
}

// MARK: - Verdict

/// Under the chosen poster: title, then year, directors, format, runtime.
private struct OracleVerdict: View {
  let film: Film

  var body: some View {
    VStack(spacing: 12) {
      NavigationLink(value: Route.film(id: film.id)) {
        Text(film.title)
          .font(.title2.bold())
          .foregroundStyle(.spineForeground)
          .multilineTextAlignment(.center)
      }
      .buttonStyle(.plain)

      OracleFlowLayout(spacing: 6) {
        if let year = film.year { Tag(text: String(year)) }
        ForEach(film.directors, id: \.self) { name in
          NavigationLink(value: Route.person(name: name)) {
            Tag(text: name, systemImage: "person.fill")
          }
          .buttonStyle(.plain)
          .accessibilityHint("Shows their films")
        }
        FormatBadge(format: film.format, size: .regular)
        if let runtime = film.runtimeMinutes {
          Tag(
            text: Formatters.runtime(runtime), fill: .lbOrange,
            foreground: Color(hex: 0x1B0E00), systemImage: "clock")
        }
      }

      Text("The Oracle has spoken. Tonight you watch this.")
        .font(.footnote)
        .foregroundStyle(.spineMutedForeground)
        .multilineTextAlignment(.center)
    }
  }
}
