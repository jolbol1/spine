import SwiftUI

/// A stacked shelf: the discs lying flat in a pile on the shelf board,
/// spines facing out, the first disc on top. Each case is drawn to scale —
/// a DVD case is longer and thicker than a Blu-ray's, box sets are thicker
/// still — with its format's logo band at one end and a slight unevenness,
/// so it reads as a real stack rather than a list.
struct ShelfPile: View {
  let slots: [ShelfSlot]
  let shelf: Shelf
  let ordered: [Film]
  let shelves: [Shelf]
  let metrics: ShelfMetrics

  @State private var expanded = false

  /// Tall piles show their top until expanded.
  private static let collapsedCount = 30

  /// The longest case (a DVD) — the pile's width.
  private var length: CGFloat { (metrics.coverWidth * 3.5).rounded() }

  var body: some View {
    let visible = expanded ? slots : Array(slots.prefix(Self.collapsedCount))
    let hiddenFilms = slots.dropFirst(visible.count).count {
      if case .film = $0 { true } else { false }
    }
    VStack(spacing: 0) {
      if slots.isEmpty {
        Text("Nothing matches this shelf yet.")
          .font(.footnote)
          .foregroundStyle(.spineMutedForeground)
          .frame(maxWidth: .infinity)
          .frame(height: 56)
          .padding(.top, metrics.top)
      } else {
        VStack(spacing: 1) {
          ForEach(visible) { slot in
            switch slot {
            case .film(let film, let position):
              ShelfPileDisc(
                marks: ShelfFilmMarks(film: film, position: position, shelf: shelf, ordered: ordered),
                shelves: shelves, length: length)
            case .ghost(let item):
              ShelfPileGhost(item: item, length: length)
            case .divider(let title, _):
              ShelfPileDivider(title: title, length: length)
            case .capacityEnd:
              ShelfPileCapacityLine(length: length)
            }
          }
        }
        .padding(.top, metrics.top + 4)
        .padding(.horizontal, 14)

        if hiddenFilms > 0 {
          Button {
            withAnimation(.snappy) { expanded = true }
          } label: {
            Label("\(hiddenFilms) more below", systemImage: "chevron.down")
              .font(.caption.weight(.semibold))
          }
          .buttonStyle(.glass)
          .controlSize(.small)
          .padding(.vertical, 8)
        }
      }
      ShelfLedge()
        .frame(height: metrics.ledge)
        .padding(.top, slots.isEmpty ? 0 : 1)
      Color.clear.frame(height: 14)
    }
    .frame(maxWidth: .infinity)
    .background {
      LinearGradient(
        colors: [Color(hex: 0x0F1318), Color(hex: 0x161C23)],
        startPoint: .top, endPoint: .bottom)
    }
    .clipShape(.rect(cornerRadius: 14))
    .overlay {
      RoundedRectangle(cornerRadius: 14).strokeBorder(.spineBorder, lineWidth: 1)
    }
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("shelf.pile")
  }
}

/// One disc lying in the pile: its spine with the format's logo band, the
/// title along it, and the slot number — NEW, pinned, and past-capacity
/// marked as on an upright shelf.
private struct ShelfPileDisc: View {
  let marks: ShelfFilmMarks
  let shelves: [Shelf]
  let length: CGFloat

  var body: some View {
    let film = marks.film
    let shape = ShelfCaseShape(
      format: film.format, packageType: film.packageType, discCount: film.discCount, key: film.id)
    let colors = ShelfCaseColors(format: film.format)
    NavigationLink(value: Route.film(id: film.id)) {
      HStack(spacing: 0) {
        Text(colors.badge)
          .font(.system(size: 8, weight: .black))
          .tracking(0.2)
          .foregroundStyle(colors.badgeText)
          .frame(width: 26)
          .frame(maxHeight: .infinity)
          .background(colors.band)
        Text(film.title)
          .font(.system(size: shape.thickness >= 30 ? 12.5 : 11.5, weight: .semibold))
          .foregroundStyle(colors.title)
          .lineLimit(1)
          .padding(.leading, 9)
        Spacer(minLength: 6)
        HStack(spacing: 5) {
          if marks.isPinnedHere {
            Image(systemName: "pin.fill")
              .font(.system(size: 8, weight: .bold))
              .foregroundStyle(.white.opacity(0.85))
          }
          if marks.isNew { ShelfNewBadge(text: "New") }
          Text("\(marks.position)")
            .font(.system(size: 9, weight: .bold).monospacedDigit())
            .foregroundStyle(marks.isOverCapacity ? Color.spineDestructive : .white.opacity(0.5))
        }
        .padding(.trailing, 7)
      }
      .frame(width: (length * shape.length).rounded(), height: shape.thickness)
      .background {
        LinearGradient(
          colors: [colors.body.opacity(0.85), colors.body, colors.edge],
          startPoint: .top, endPoint: .bottom)
      }
      .overlay(alignment: .top) {
        // The lit top edge of the plastic.
        Rectangle().fill(.white.opacity(0.16)).frame(height: 1)
      }
      .overlay(alignment: .bottom) {
        // Where it rests on the case below.
        Rectangle().fill(.black.opacity(0.35)).frame(height: 1)
      }
      .overlay(alignment: .leading) {
        // The hinge between the logo band and the spine.
        Rectangle().fill(.black.opacity(0.3)).frame(width: 1).padding(.leading, 26)
      }
      .clipShape(.rect(cornerRadius: 2.5))
      .overlay {
        if marks.isNew {
          RoundedRectangle(cornerRadius: 2.5).strokeBorder(.lbOrange, lineWidth: 1.5)
        }
      }
      .opacity(marks.isOverCapacity ? 0.55 : 1)
      .shadow(color: .black.opacity(0.55), radius: 1.2, y: 1.2)
      .offset(x: shape.offset)
      .frame(maxWidth: .infinity)
      .contentShape(.rect)
    }
    .buttonStyle(.plain)
    .shelfFilmMenu(marks, shelves: shelves)
  }
}

/// The plastic of each format's case: Blu-ray's blue, 4K's black with its
/// black-and-white band, DVD's dark grey.
private struct ShelfCaseColors {
  let body: Color
  let edge: Color
  let band: Color
  let badge: String
  let badgeText: Color
  let title: Color

  init(format: String?) {
    switch format {
    case "4K UHD":
      body = Color(hex: 0x1A1C20)
      edge = Color(hex: 0x0B0C0E)
      band = Color.formatBadge("4K UHD").fill
      badge = "4K"
      badgeText = Color.formatBadge("4K UHD").text
    case "Blu-ray":
      body = Color(hex: 0x16466F)
      edge = Color(hex: 0x0C2840)
      band = Color.formatBadge("Blu-ray").fill
      badge = "BD"
      badgeText = Color.formatBadge("Blu-ray").text
    default:
      body = Color(hex: 0x2A3038)
      edge = Color(hex: 0x15191E)
      band = Color.formatBadge("DVD").fill
      badge = "DVD"
      badgeText = Color.formatBadge("DVD").text
    }
    title = Color(hex: 0xF4F7FA).opacity(0.94)
  }
}

/// A wishlist item where it would lie — dashed and see-through.
private struct ShelfPileGhost: View {
  let item: WishlistItem
  let length: CGFloat

  var body: some View {
    let shape = ShelfCaseShape(format: item.format, key: item.id)
    HStack(spacing: 4) {
      Image(systemName: "heart")
      Text(item.title).italic().lineLimit(1)
      Spacer(minLength: 0)
    }
    .font(.system(size: 10.5))
    .foregroundStyle(.spineMutedForeground)
    .padding(.horizontal, 10)
    .frame(width: (length * shape.length).rounded(), height: shape.thickness)
    .overlay {
      RoundedRectangle(cornerRadius: 2.5)
        .strokeBorder(Color.spineMutedForeground, style: StrokeStyle(lineWidth: 1.2, dash: [5, 4]))
    }
    .opacity(0.6)
    .offset(x: shape.offset)
    .frame(maxWidth: .infinity)
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("\(item.title) — on your wishlist; would shelve here")
  }
}

/// A divider card between group runs, poking out of the pile.
private struct ShelfPileDivider: View {
  let title: String
  let length: CGFloat

  var body: some View {
    HStack(spacing: 6) {
      Rectangle().fill(.lbBlue).frame(width: 3)
      Text(title.uppercased())
        .font(.system(size: 8.5, weight: .bold))
        .tracking(1.1)
        .foregroundStyle(.spineForeground)
        .lineLimit(1)
      Spacer(minLength: 0)
    }
    .frame(width: length + 18, height: 13)
    .background {
      LinearGradient(
        colors: [Color(hex: 0x3A4655), Color(hex: 0x2C3542)],
        startPoint: .top, endPoint: .bottom)
    }
    .clipShape(.rect(cornerRadius: 2))
    .shadow(color: .black.opacity(0.4), radius: 1, y: 1)
    .frame(maxWidth: .infinity)
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(title)
    .accessibilityAddTraits(.isHeader)
  }
}

/// Where the shelf's physical capacity runs out; the rest is the spill.
private struct ShelfPileCapacityLine: View {
  let length: CGFloat

  var body: some View {
    HStack(spacing: 6) {
      Capsule().fill(.spineDestructive).frame(height: 3)
      Text("CAPACITY")
        .font(.system(size: 8, weight: .heavy))
        .tracking(0.8)
        .foregroundStyle(.spineDestructive)
    }
    .frame(width: length + 18)
    .padding(.vertical, 3)
    .frame(maxWidth: .infinity)
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("End of shelf capacity")
  }
}
