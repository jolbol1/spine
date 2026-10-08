import SwiftUI

/// The shelf order check's results, as `List` sections: a summary with the
/// photographed sequence, the moves in plain words, discs that belong
/// elsewhere, uncatalogued spines, and discs the photos didn't show.
struct ShelfOrderSections: View {
  let check: ShelfOrder.Check
  /// Uncatalogued spines, re-checked against the collection as it is now.
  let added: (ShelfSpine) -> Film?
  let onAdd: (ShelfSpine) -> Void
  let onMarkArranged: () -> Void

  private var stacked: Bool { check.shelf.isStacked }

  var body: some View {
    let moves = check.moves
    let elsewhere = check.spines.filter { $0.placement == .otherShelf }
    let unshelved = check.spines.filter { $0.placement == .unshelved }
    let uncatalogued = check.spines.filter { $0.placement == .notCatalogued }

    Section {
      ShelfOrderSummary(check: check, onMarkArranged: onMarkArranged)
      if !check.spines.isEmpty {
        ShelfOrderStrip(spines: check.spines, stacked: stacked)
          .listRowInsets(EdgeInsets(top: 12, leading: 16, bottom: 12, trailing: 16))
      }
    } header: {
      Text("Order of “\(check.shelf.name)”")
    }
    .listRowBackground(Color.spineCard)

    if !moves.isEmpty {
      Section {
        ForEach(Array(moves.enumerated()), id: \.offset) { _, placed in
          if let film = placed.film {
            NavigationLink(value: Route.film(id: film.id)) {
              ShelfOrderMoveRow(placed: placed, film: film, stacked: stacked)
            }
          }
        }
      } header: {
        ShelfCheckSectionHeader(title: "Moves", count: moves.count)
      } footer: {
        Text(
          stacked
            ? "Everything else is already in order, top to bottom — these are the fewest moves that put the pile right."
            : "Everything else is already in order, left to right — these are the fewest moves that put the shelf right."
        )
      }
      .listRowBackground(Color.spineCard)
    }

    if !elsewhere.isEmpty {
      Section {
        ForEach(Array(elsewhere.enumerated()), id: \.offset) { _, placed in
          if let film = placed.film, let home = placed.belongsOn {
            NavigationLink(value: Route.film(id: film.id)) {
              ShelfOrderFilmRow(
                film: film,
                detail: Text("\(Image(systemName: "arrow.right")) \(home.name)"),
                tint: .lbBlue)
            }
          }
        }
      } header: {
        ShelfCheckSectionHeader(title: "Belongs on another shelf", count: elsewhere.count)
      }
      .listRowBackground(Color.spineCard)
    }

    if !unshelved.isEmpty {
      Section {
        ForEach(Array(unshelved.enumerated()), id: \.offset) { _, placed in
          if let film = placed.film {
            NavigationLink(value: Route.film(id: film.id)) {
              ShelfOrderFilmRow(
                film: film, detail: Text("No shelf claims it"), tint: .spineMutedForeground)
            }
          }
        }
      } header: {
        ShelfCheckSectionHeader(title: "Unshelved", count: unshelved.count)
      }
      .listRowBackground(Color.spineCard)
    }

    if !uncatalogued.isEmpty {
      Section {
        ForEach(Array(uncatalogued.enumerated()), id: \.offset) { _, placed in
          if let film = added(placed.spine) {
            NavigationLink(value: Route.film(id: film.id)) {
              ShelfCheckMissingRow(spine: placed.spine, added: true, add: {})
            }
          } else {
            ShelfCheckMissingRow(spine: placed.spine, added: false) { onAdd(placed.spine) }
          }
        }
      } header: {
        ShelfCheckSectionHeader(title: "Not catalogued", count: uncatalogued.count)
      }
      .listRowBackground(Color.spineCard)
    }

    if !check.absent.isEmpty {
      Section {
        ForEach(check.absent) { film in
          NavigationLink(value: Route.film(id: film.id)) {
            ShelfOrderFilmRow(
              film: film, detail: Text("Moved, lent out, or misfiled?"),
              tint: .spineMutedForeground)
          }
        }
      } header: {
        ShelfCheckSectionHeader(
          title: "Expected here but not in the photo", count: check.absent.count)
      }
      .listRowBackground(Color.spineCard)
    }
  }
}

/// "All 24 in order" or "3 to move", with Mark Arranged once it's right.
private struct ShelfOrderSummary: View {
  let check: ShelfOrder.Check
  let onMarkArranged: () -> Void

  var body: some View {
    let moves = check.moves.count
    let inOrder = check.inOrderCount
    VStack(alignment: .leading, spacing: 10) {
      HStack(alignment: .firstTextBaseline, spacing: 10) {
        Image(systemName: symbol(moves: moves, inOrder: inOrder))
          .foregroundStyle(tint(moves: moves, inOrder: inOrder))
          .accessibilityHidden(true)
        VStack(alignment: .leading, spacing: 3) {
          Text(title(moves: moves, inOrder: inOrder))
            .font(.title3.weight(.bold))
            .foregroundStyle(.spineForeground)
          Text(detail(moves: moves, inOrder: inOrder))
            .font(.subheadline)
            .foregroundStyle(.spineMutedForeground)
            .fixedSize(horizontal: false, vertical: true)
          if let extras = extras {
            Text(extras)
              .font(.caption)
              .foregroundStyle(.spineMutedForeground)
              .fixedSize(horizontal: false, vertical: true)
          }
        }
      }
      .accessibilityElement(children: .combine)
      if ShelfOrderWords.isInOrder(check) {
        Button(action: onMarkArranged) {
          Label("Mark Arranged", systemImage: "checkmark.circle")
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(.onAccent)
            .padding(.horizontal, 4)
        }
        .buttonStyle(.glassProminent)
        .tint(.lbGreen)
      }
    }
    .padding(.vertical, 4)
  }

  private func title(moves: Int, inOrder: Int) -> String {
    if moves > 0 { return "\(moves) to move" }
    if inOrder == 0 { return "Nothing photographed belongs on this shelf" }
    return inOrder == 1 ? "In order" : "All \(inOrder) in order"
  }

  private func detail(moves: Int, inOrder: Int) -> String {
    if moves > 0 { return "\(inOrder) of \(inOrder + moves) already in place" }
    if inOrder == 0 { return "Check the photos show this shelf, or pick another" }
    return check.shelf.isStacked
      ? "Top to bottom, as the pile should be" : "Left to right, as the shelf should be"
  }

  /// Everything else the photos turned up, in a line.
  private var extras: String? {
    var parts: [String] = []
    let elsewhere = check.spines.count { $0.placement == .otherShelf }
    if elsewhere > 0 { parts.append("\(elsewhere) belong\(elsewhere == 1 ? "s" : "") elsewhere") }
    let unshelved = check.spines.count { $0.placement == .unshelved }
    if unshelved > 0 { parts.append("\(unshelved) unshelved") }
    let uncatalogued = check.spines.count { $0.placement == .notCatalogued }
    if uncatalogued > 0 { parts.append("\(uncatalogued) not catalogued") }
    if !check.absent.isEmpty { parts.append("\(check.absent.count) not in the photos") }
    return parts.isEmpty ? nil : parts.joined(separator: " · ")
  }

  private func symbol(moves: Int, inOrder: Int) -> String {
    moves > 0 ? "arrow.left.arrow.right.circle.fill" : inOrder > 0 ? "checkmark.circle.fill" : "questionmark.circle.fill"
  }

  private func tint(moves: Int, inOrder: Int) -> Color {
    moves > 0 ? .lbOrange : inOrder > 0 ? .lbGreen : .spineMutedForeground
  }
}

// MARK: - The photographed sequence

/// Every spine photographed, in reading order, each marked: in order,
/// to move, another shelf's, unshelved, or not catalogued. Spines stand for
/// an upright shelf and lie in a pile for a stacked one.
private struct ShelfOrderStrip: View {
  let spines: [ShelfOrder.PlacedSpine]
  let stacked: Bool

  var body: some View {
    if stacked {
      VStack(spacing: 2) {
        ForEach(Array(spines.enumerated()), id: \.offset) { index, placed in
          ShelfOrderTile(placed: placed, number: index + 1, stacked: true)
        }
      }
      .frame(maxWidth: 320)
      .frame(maxWidth: .infinity)
    } else {
      ScrollView(.horizontal) {
        HStack(alignment: .bottom, spacing: 3) {
          ForEach(Array(spines.enumerated()), id: \.offset) { index, placed in
            ShelfOrderTile(placed: placed, number: index + 1, stacked: false)
          }
        }
        .padding(.vertical, 2)
      }
      .scrollIndicators(.hidden)
    }
  }
}

private struct ShelfOrderTile: View {
  let placed: ShelfOrder.PlacedSpine
  let number: Int
  let stacked: Bool

  var body: some View {
    let style = ShelfOrderMark(placed.placement)
    Group {
      if stacked {
        HStack(spacing: 8) {
          Text("\(number)")
            .font(.system(size: 9, weight: .bold).monospacedDigit())
            .foregroundStyle(.spineMutedForeground)
            .frame(width: 18, alignment: .trailing)
          Text(placed.film?.title ?? placed.spine.title)
            .font(.caption2.weight(.semibold))
            .foregroundStyle(.spineForeground)
            .lineLimit(1)
          Spacer(minLength: 4)
          Image(systemName: style.symbol)
            .font(.system(size: 10, weight: .bold))
            .foregroundStyle(style.tint)
        }
        .padding(.horizontal, 8)
        .frame(height: 22)
        .background(style.fill, in: .rect(cornerRadius: 3))
        .overlay(alignment: .leading) {
          UnevenRoundedRectangle(topLeadingRadius: 3, bottomLeadingRadius: 3)
            .fill(style.tint)
            .frame(width: 3)
        }
      } else {
        VStack(spacing: 4) {
          Text(placed.film?.title ?? placed.spine.title)
            .font(.system(size: 10, weight: .semibold))
            .foregroundStyle(.spineForeground)
            .lineLimit(1)
            .frame(width: 84)
            .rotationEffect(.degrees(-90))
            .frame(width: 28, height: 84)
          Image(systemName: style.symbol)
            .font(.system(size: 10, weight: .bold))
            .foregroundStyle(style.tint)
          Text("\(number)")
            .font(.system(size: 9, weight: .bold).monospacedDigit())
            .foregroundStyle(.spineMutedForeground)
        }
        .padding(.vertical, 6)
        .frame(width: 30)
        .background(style.fill, in: .rect(cornerRadius: 4))
        .overlay(alignment: .top) {
          UnevenRoundedRectangle(topLeadingRadius: 4, topTrailingRadius: 4)
            .fill(style.tint)
            .frame(height: 3)
        }
      }
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("\(number). \(placed.film?.title ?? placed.spine.title), \(style.label)")
  }
}

/// How each placement is marked in the strip.
private struct ShelfOrderMark {
  let symbol: String
  let tint: Color
  let fill: Color
  let label: String

  init(_ placement: ShelfOrder.Placement) {
    switch placement {
    case .inOrder:
      (symbol, tint, label) = ("checkmark", .lbGreen, "in order")
    case .outOfOrder:
      (symbol, tint, label) = ("arrow.left.arrow.right", .lbOrange, "to move")
    case .otherShelf:
      (symbol, tint, label) = ("arrow.turn.down.right", .lbBlue, "belongs on another shelf")
    case .unshelved:
      (symbol, tint, label) = ("questionmark", .spineMutedForeground, "unshelved")
    case .notCatalogued:
      (symbol, tint, label) = ("plus", .spineMutedForeground, "not catalogued")
    }
    fill = placement == .inOrder ? Color.spineSecondary : tint.opacity(0.16)
  }
}

// MARK: - Rows

/// "Move *Dune* between *Cure* and *Eraserhead*" — "to the start, before …"
/// or "to the end, after …" (the top / bottom of a stack).
private struct ShelfOrderMoveRow: View {
  let placed: ShelfOrder.PlacedSpine
  let film: Film
  let stacked: Bool

  var body: some View {
    HStack(spacing: 12) {
      PosterFrame(url: film.coverURL, title: film.title, cornerRadius: 3, maxPixelSize: 120)
        .frame(width: 30)
      instruction
        .font(.subheadline)
        .foregroundStyle(.spineForeground)
        .fixedSize(horizontal: false, vertical: true)
    }
    .padding(.vertical, 2)
  }

  private var instruction: Text {
    let phrases = ShelfOrderWords.moveSentence(placed, stacked: stacked) ?? []
    return phrases.reduce(Text(verbatim: "")) { sentence, phrase in
      switch phrase {
      case .text(let words): Text("\(sentence)\(words)")
      case .film(let film): Text("\(sentence)\(Text(film.title).bold())")
      }
    }
  }
}

/// A catalogued film with one line about it.
private struct ShelfOrderFilmRow: View {
  let film: Film
  let detail: Text
  let tint: Color

  var body: some View {
    HStack(spacing: 12) {
      PosterFrame(url: film.coverURL, title: film.title, cornerRadius: 3, maxPixelSize: 120)
        .frame(width: 30)
      VStack(alignment: .leading, spacing: 3) {
        Text("\(film.title)\(film.year.map { " (\($0))" } ?? "")")
          .font(.subheadline.weight(.semibold))
          .foregroundStyle(.spineForeground)
          .lineLimit(2)
        detail
          .font(.caption)
          .foregroundStyle(tint)
      }
    }
    .padding(.vertical, 2)
    .accessibilityElement(children: .combine)
  }
}
