import SwiftUI

/// One thing standing on a shelf, left to right.
enum ShelfSlot: Identifiable {
  case film(Film, position: Int)
  /// A wishlist item, translucent, where it would slot in by title.
  case ghost(WishlistItem)
  /// A group divider card — "Criterion", "1990s" — before each run.
  case divider(String, index: Int)
  /// Where the shelf's physical capacity runs out.
  case capacityEnd

  var id: String {
    switch self {
    case .film(let film, _): "film-\(film.id)"
    case .ghost(let item): "ghost-\(item.id)"
    case .divider(_, let index): "divider-\(index)"
    case .capacityEnd: "capacity-end"
    }
  }

  /// Films in display order with ghosts interleaved at their insertion
  /// slots, a divider at the start of each contiguous group run, and the
  /// capacity marker after the last film that fits.
  static func build(shelf: Shelf, ordered: [Film], ghosts: [WishlistItem]) -> [ShelfSlot] {
    var inserts: [Int: [WishlistItem]] = [:]
    for item in ghosts {
      inserts[ShelfEngine.ghostInsertionIndex(ordered, item), default: []].append(item)
    }
    var slots: [ShelfSlot] = []
    var started = false
    var lastGroup: String?
    for index in 0...ordered.count {
      for item in inserts[index] ?? [] { slots.append(.ghost(item)) }
      guard index < ordered.count else { break }
      let film = ordered[index]
      if shelf.groupBy != nil {
        let group = ShelfEngine.groupKey(film, shelf)
        if !started || group != lastGroup {
          slots.append(.divider(group ?? "Other", index: slots.count))
          started = true
          lastGroup = group
        }
      }
      slots.append(.film(film, position: index + 1))
      if let capacity = shelf.capacity, capacity > 0, index + 1 == capacity,
        ordered.count > capacity
      {
        slots.append(.capacityEnd)
      }
    }
    return slots
  }
}

/// A shelf: its header, then a cubby with covers standing on a ledge.
struct ShelfSectionView: View {
  let shelf: Shelf
  let index: Int
  let shelves: [Shelf]
  let ordered: [Film]
  let ghosts: [WishlistItem]
  let metrics: ShelfMetrics
  let gutter: CGFloat
  var onEdit: () -> Void
  var onArrange: () -> Void
  var onDelete: () -> Void

  @Environment(ShelvesStore.self) private var store

  private var overflow: [Film] { ShelfEngine.overflow(shelf, ordered) }
  private var newCount: Int { ordered.count { ShelfEngine.isNewSinceArranged(shelf, $0) } }
  private var isHandArranged: Bool { shelf.manualOrder?.isEmpty == false }

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      header
        .padding(.horizontal, gutter)
      ShelfCubby(
        slots: ShelfSlot.build(shelf: shelf, ordered: ordered, ghosts: ghosts),
        metrics: metrics,
        emptyMessage: "Nothing matches this shelf yet."
      ) { film, position in
        ShelfCoverCell(
          film: film, position: position, shelf: shelf, ordered: ordered,
          shelves: shelves, metrics: metrics)
      }
      .padding(.horizontal, gutter)
      if !overflow.isEmpty {
        Text(
          "Suggested spill to the next shelf: \(overflow.map(\.title).formatted(.list(type: .and)))"
        )
        .font(.footnote)
        .foregroundStyle(.spineMutedForeground)
        .lineLimit(3)
        .padding(.horizontal, gutter)
      }
    }
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Shelf: \(shelf.name)")
  }

  private var header: some View {
    HStack(alignment: .center, spacing: 12) {
      VStack(alignment: .leading, spacing: 5) {
        Text(shelf.name)
          .font(.title3.weight(.bold))
          .foregroundStyle(.spineForeground)
          .accessibilityAddTraits(.isHeader)
        meta
      }
      Spacer(minLength: 8)
      menu
    }
  }

  private var meta: some View {
    ViewThatFits(in: .horizontal) {
      metaRow(spelledOut: true)
      metaRow(spelledOut: false)
    }
  }

  private func metaRow(spelledOut: Bool) -> some View {
    HStack(spacing: 8) {
      Text(countText)
        .font(.footnote.monospacedDigit())
        .foregroundStyle(.spineMutedForeground)
      if !overflow.isEmpty {
        Text("over by \(overflow.count)")
          .font(.footnote.weight(.semibold))
          .foregroundStyle(.spineDestructive)
      }
      if newCount > 0 {
        ShelfNewBadge(text: "\(newCount) new")
      }
      if isHandArranged {
        Label("Hand-arranged", systemImage: "hand.draw")
          .labelStyle(spelledOut ? AnyLabelStyle.titleAndIcon : AnyLabelStyle.iconOnly)
          .font(.footnote)
          .foregroundStyle(.spineMutedForeground)
      }
    }
    .lineLimit(1)
    .fixedSize(horizontal: spelledOut, vertical: false)
  }

  private var countText: String {
    var text = shelf.capacity.map { "\(ordered.count) / \($0)" } ?? "\(ordered.count)"
    if !ghosts.isEmpty { text += " · \(Formatters.count(ghosts.count, "ghost"))" }
    return text
  }

  private var menu: some View {
    Menu {
      Button("Edit Shelf", systemImage: "pencil", action: onEdit)
      Button("Arrange by Hand", systemImage: "hand.draw", action: onArrange)
        .disabled(ordered.count < 2)
      Button {
        store.markArranged([shelf.id])
      } label: {
        Label("Mark Arranged", systemImage: "checkmark.circle")
        Text("Clears the NEW flags")
      }
      if isHandArranged {
        Button("Reset Hand-Arranged Order", systemImage: "arrow.counterclockwise") {
          store.clearManualOrder(on: shelf.id)
        }
      }
      Section {
        Button("Move Up", systemImage: "arrow.up") { store.move(id: shelf.id, by: -1) }
          .disabled(index == 0)
        Button("Move Down", systemImage: "arrow.down") { store.move(id: shelf.id, by: 1) }
          .disabled(index == shelves.count - 1)
      }
      Section {
        Button("Delete Shelf", systemImage: "trash", role: .destructive, action: onDelete)
      }
    } label: {
      Image(systemName: "ellipsis")
        .font(.body.weight(.semibold))
        .foregroundStyle(.spineForeground)
        .frame(width: 26, height: 26)
    }
    .buttonStyle(.glass)
    .buttonBorderShape(.circle)
    .accessibilityLabel("Options for \(shelf.name)")
  }
}

/// The recessed box a shelf's covers stand in, with the ledge fixed under
/// them while the row scrolls sideways.
struct ShelfCubby<Cover: View>: View {
  let slots: [ShelfSlot]
  let metrics: ShelfMetrics
  var emptyMessage: String
  var showsLedge = true
  @ViewBuilder var cover: (Film, Int) -> Cover

  private let emptyHeight: CGFloat = 56

  var body: some View {
    ZStack(alignment: .top) {
      if showsLedge {
        ShelfLedge()
          .frame(height: metrics.ledge)
          .padding(.top, metrics.top + (slots.isEmpty ? emptyHeight : metrics.coverHeight))
      }
      if slots.isEmpty {
        Text(emptyMessage)
          .font(.footnote)
          .foregroundStyle(.spineMutedForeground)
          .frame(maxWidth: .infinity)
          .frame(height: emptyHeight)
          .padding(.top, metrics.top)
          .padding(.bottom, metrics.ledge + 14)
      } else {
        ScrollView(.horizontal) {
          LazyHStack(alignment: .top, spacing: metrics.spacing) {
            ForEach(slots) { slot in
              switch slot {
              case .film(let film, let position): cover(film, position)
              case .ghost(let item): ShelfGhostCell(item: item, metrics: metrics)
              case .divider(let title, _): ShelfDividerCell(title: title, metrics: metrics)
              case .capacityEnd: ShelfCapacityMarker(metrics: metrics)
              }
            }
          }
          .padding(.top, metrics.top)
          .padding(.bottom, 12)
        }
        .scrollIndicators(.hidden)
        .contentMargins(.horizontal, 14, for: .scrollContent)
      }
    }
    .background {
      LinearGradient(
        colors: [Color(hex: 0x0F1318), Color(hex: 0x161C23)],
        startPoint: .top, endPoint: .bottom)
    }
    .clipShape(.rect(cornerRadius: 14))
    .overlay {
      RoundedRectangle(cornerRadius: 14).strokeBorder(.spineBorder, lineWidth: 1)
    }
  }
}

/// The shelf board: a lit top edge over a darker front face.
private struct ShelfLedge: View {
  var body: some View {
    VStack(spacing: 0) {
      Color(hex: 0x5A687C).frame(height: 1)
      LinearGradient(
        colors: [Color(hex: 0x3C4756), Color(hex: 0x29313C)],
        startPoint: .top, endPoint: .bottom)
    }
    .shadow(color: .black.opacity(0.55), radius: 6, y: 5)
    .accessibilityHidden(true)
  }
}

/// A film's cover on a shelf: slot number, pin and NEW markers, and the
/// pin / remove menu.
struct ShelfCoverCell: View {
  let film: Film
  let position: Int
  let shelf: Shelf
  let ordered: [Film]
  let shelves: [Shelf]
  let metrics: ShelfMetrics

  @Environment(ShelvesStore.self) private var store

  private var isNew: Bool { ShelfEngine.isNewSinceArranged(shelf, film) }
  private var isPinnedHere: Bool { shelf.pinned?.contains(film.id) ?? false }
  private var isOverCapacity: Bool { shelf.capacity.map { position > $0 } ?? false }

  var body: some View {
    NavigationLink(value: Route.film(id: film.id)) {
      VStack(spacing: 0) {
        PosterFrame(url: film.coverURL, title: film.title, cornerRadius: 4, maxPixelSize: 360)
          .frame(width: metrics.coverWidth, height: metrics.coverHeight)
          .opacity(isOverCapacity ? 0.6 : 1)
          .overlay {
            if isNew {
              RoundedRectangle(cornerRadius: 4).strokeBorder(.lbOrange, lineWidth: 2)
            }
          }
          .overlay(alignment: .topLeading) {
            ShelfPositionChip(position: position, isOver: isOverCapacity).padding(4)
          }
          .overlay(alignment: .topTrailing) {
            if isPinnedHere {
              Image(systemName: "pin.fill")
                .font(.system(size: 9, weight: .bold))
                .foregroundStyle(.white)
                .frame(width: 20, height: 20)
                .background(Color.spineBackground.opacity(0.8), in: .circle)
                .padding(4)
            }
          }
          .overlay(alignment: .bottomTrailing) {
            if isNew { ShelfNewBadge(text: "New").padding(4) }
          }
          .shadow(color: .black.opacity(0.5), radius: 3, y: 2)
        Color.clear.frame(height: metrics.ledge)
        Text(film.title)
          .font(.caption2.weight(.medium))
          .foregroundStyle(.spineForeground)
          .lineLimit(1)
          .frame(width: metrics.coverWidth, alignment: .leading)
          .padding(.top, 7)
      }
      .contentShape(.rect)
    }
    .buttonStyle(.plain)
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(accessibilityText)
    .accessibilityHint(newHint ?? "")
    .accessibilityAddTraits(.isLink)
    .contextMenu {
      Section {
        ShelfPinMenu(filmID: film.id, shelves: shelves.filter { $0.id != shelf.id })
        if isPinnedHere {
          Button("Unpin — Follow Rules Again", systemImage: "pin.slash") {
            store.unpin(filmID: film.id)
          }
        } else {
          Button("Remove from This Shelf", systemImage: "minus.circle") {
            store.exclude(filmID: film.id, from: shelf.id)
          }
        }
      } header: {
        if let newHint { Text(newHint) }
      }
    } preview: {
      ShelfCoverPreview(film: film)
    }
  }

  /// "Added since this shelf was arranged — slot 4, between Alien and Dune".
  private var newHint: String? {
    guard isNew else { return nil }
    var hint = "Added since this shelf was arranged — slot \(position)"
    if ordered.count > 1 {
      let index = position - 1
      let before = index > 0 ? ordered[index - 1].title : "the start"
      let after = index < ordered.count - 1 ? ordered[index + 1].title : "the end"
      hint += ", between \(before) and \(after)"
    }
    return hint
  }

  private var accessibilityText: String {
    var parts = [film.title, "slot \(position)"]
    if isOverCapacity { parts.append("past capacity") }
    if isPinnedHere { parts.append("pinned to this shelf") }
    if isNew { parts.append("new since arranged") }
    return parts.joined(separator: ", ")
  }
}

/// "Pin to Shelf ▸ <shelf names>" — every pin action goes through here.
struct ShelfPinMenu: View {
  let filmID: String
  let shelves: [Shelf]
  @Environment(ShelvesStore.self) private var store

  var body: some View {
    if !shelves.isEmpty {
      Menu {
        ForEach(shelves) { shelf in
          Button(shelf.name) { store.pin(filmID: filmID, to: shelf.id) }
        }
      } label: {
        Label("Pin to Shelf", systemImage: "pin")
      }
    }
  }
}

/// The lifted cover in a context menu.
private struct ShelfCoverPreview: View {
  let film: Film

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      PosterFrame(url: film.coverURL, title: film.title, cornerRadius: 8, maxPixelSize: 600)
        .frame(width: 220)
      VStack(alignment: .leading, spacing: 4) {
        Text(film.title)
          .font(.headline)
          .foregroundStyle(.spineForeground)
        HStack(spacing: 6) {
          if let year = film.year {
            Text(String(year)).font(.subheadline).foregroundStyle(.spineMutedForeground)
          }
          FormatBadge(format: film.format)
          if let label = film.label {
            Text(label).font(.subheadline).foregroundStyle(.spineMutedForeground)
              .lineLimit(1)
          }
        }
      }
      .frame(width: 220, alignment: .leading)
    }
    .padding(14)
    .background(Color.spinePopover)
  }
}

/// The slot number in a cover's corner — red once past capacity. A dark
/// plate rather than glass, so it reads on pale covers too.
private struct ShelfPositionChip: View {
  let position: Int
  let isOver: Bool

  var body: some View {
    Text("\(position)")
      .font(.system(size: 10, weight: .bold).monospacedDigit())
      .foregroundStyle(.white)
      .padding(.horizontal, 5)
      .padding(.vertical, 2)
      .background(
        isOver ? Color.spineDestructive.opacity(0.92) : Color.spineBackground.opacity(0.8),
        in: .rect(cornerRadius: 4)
      )
      .fixedSize()
  }
}

/// The orange NEW flag.
struct ShelfNewBadge: View {
  let text: String

  var body: some View {
    Text(text.uppercased())
      .font(.system(size: 9, weight: .heavy))
      .tracking(0.4)
      .foregroundStyle(Color(hex: 0x1B0F04))
      .padding(.horizontal, 5)
      .padding(.vertical, 2)
      .background(.lbOrange, in: .rect(cornerRadius: 3))
      .fixedSize()
  }
}

/// A wishlist item standing where it would go — dashed and see-through.
private struct ShelfGhostCell: View {
  let item: WishlistItem
  let metrics: ShelfMetrics

  var body: some View {
    VStack(spacing: 0) {
      PosterFrame(
        url: item.coverUrl.flatMap(URL.init(string:)), title: item.title, cornerRadius: 4,
        maxPixelSize: 360
      )
      .frame(width: metrics.coverWidth, height: metrics.coverHeight)
      .overlay {
        RoundedRectangle(cornerRadius: 4)
          .strokeBorder(
            Color.spineMutedForeground, style: StrokeStyle(lineWidth: 1.5, dash: [5, 4]))
      }
      .opacity(0.5)
      Color.clear.frame(height: metrics.ledge)
      HStack(spacing: 3) {
        Image(systemName: "heart")
        Text(item.title).italic()
      }
      .font(.caption2)
      .foregroundStyle(.spineMutedForeground)
      .lineLimit(1)
      .frame(width: metrics.coverWidth, alignment: .leading)
      .padding(.top, 7)
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("\(item.title) — on your wishlist; would shelve here")
  }
}

/// A divider card standing between group runs, its label read upwards like
/// a spine.
private struct ShelfDividerCell: View {
  let title: String
  let metrics: ShelfMetrics

  var body: some View {
    let height = (metrics.coverHeight * 0.94).rounded()
    VStack(spacing: 0) {
      RoundedRectangle(cornerRadius: 3)
        .fill(
          LinearGradient(
            colors: [Color(hex: 0x3A4655), Color(hex: 0x2C3542)],
            startPoint: .leading, endPoint: .trailing)
        )
        .overlay(alignment: .top) {
          Rectangle().fill(.lbBlue).frame(height: 2).clipShape(.rect(cornerRadius: 1))
            .padding(.horizontal, 3)
            .padding(.top, 4)
        }
        .overlay {
          Text(title.uppercased())
            .font(.caption2.weight(.bold))
            .tracking(1.2)
            .foregroundStyle(.spineForeground)
            .lineLimit(1)
            .minimumScaleFactor(0.6)
            .frame(width: height - 20)
            .rotationEffect(.degrees(-90))
        }
        .frame(width: 26, height: height)
        .shadow(color: .black.opacity(0.4), radius: 2, y: 1)
        .frame(height: metrics.coverHeight, alignment: .bottom)
      Color.clear.frame(height: metrics.ledge)
      ShelfCaptionSpacer()
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(title)
    .accessibilityAddTraits(.isHeader)
  }
}

/// Where the physical shelf runs out — anything after it is the spill.
private struct ShelfCapacityMarker: View {
  let metrics: ShelfMetrics

  var body: some View {
    VStack(spacing: 0) {
      Capsule()
        .fill(.spineDestructive)
        .frame(width: 3, height: metrics.coverHeight)
        .padding(.horizontal, 2)
      Color.clear.frame(height: metrics.ledge)
      ShelfCaptionSpacer()
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("End of shelf capacity")
  }
}

/// Films no shelf claims — a dashed tray so nothing silently vanishes.
struct ShelfUnshelvedTray: View {
  let films: [Film]
  let shelves: [Shelf]
  let metrics: ShelfMetrics
  let gutter: CGFloat

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      VStack(alignment: .leading, spacing: 4) {
        HStack(spacing: 8) {
          Text("Unshelved")
            .font(.title3.weight(.bold))
            .foregroundStyle(.spineForeground)
            .accessibilityAddTraits(.isHeader)
          Text("\(films.count)")
            .font(.footnote.monospacedDigit())
            .foregroundStyle(.lbOrange)
        }
        Text("no shelf claims these — add a rule, a catch-all shelf, or pin them somewhere")
          .font(.footnote)
          .foregroundStyle(.spineMutedForeground)
          .fixedSize(horizontal: false, vertical: true)
      }
      .padding(.horizontal, gutter)

      ScrollView(.horizontal) {
        LazyHStack(alignment: .top, spacing: metrics.spacing) {
          ForEach(films) { film in
            NavigationLink(value: Route.film(id: film.id)) {
              VStack(alignment: .leading, spacing: 7) {
                PosterFrame(url: film.coverURL, title: film.title, cornerRadius: 4, maxPixelSize: 360)
                  .frame(width: metrics.coverWidth, height: metrics.coverHeight)
                Text(film.title)
                  .font(.caption2.weight(.medium))
                  .foregroundStyle(.spineForeground)
                  .lineLimit(1)
                  .frame(width: metrics.coverWidth, alignment: .leading)
              }
              .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(film.title)
            .accessibilityAddTraits(.isLink)
            .contextMenu {
              ShelfPinMenu(filmID: film.id, shelves: shelves)
            } preview: {
              ShelfCoverPreview(film: film)
            }
          }
        }
        .padding(.vertical, 14)
      }
      .scrollIndicators(.hidden)
      .contentMargins(.horizontal, 14, for: .scrollContent)
      .overlay {
        RoundedRectangle(cornerRadius: 14)
          .strokeBorder(
            Color.spineMutedForeground.opacity(0.45), style: StrokeStyle(lineWidth: 1.5, dash: [6, 5]))
      }
      .padding(.horizontal, gutter)
    }
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Unshelved films")
  }
}

/// Switches a label between title-and-icon and icon-only.
private enum AnyLabelStyle: LabelStyle {
  case titleAndIcon, iconOnly

  func makeBody(configuration: Configuration) -> some View {
    HStack(spacing: 4) {
      configuration.icon
      if self == .titleAndIcon { configuration.title }
    }
  }
}

/// An empty caption line, so cells without a title (dividers, the capacity
/// marker) are as tall as covers and the row never clips the titles.
private struct ShelfCaptionSpacer: View {
  var body: some View {
    Text(verbatim: " ")
      .font(.caption2.weight(.medium))
      .padding(.top, 7)
      .hidden()
      .accessibilityHidden(true)
  }
}
