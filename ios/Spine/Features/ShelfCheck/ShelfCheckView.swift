import PhotosUI
import SwiftUI

/// Photograph a shelf and see what isn't catalogued: the server reads each
/// photo's disc spines and checks them against the collection. Pushed from
/// the Shelves tab and Collection's Add menu.
///
/// With a shelf (its ⋯ menu's "Check Order with a Photo") it checks that
/// shelf's order instead: which discs stand where the shelf's order puts
/// them, and the fewest moves that put it right. Without one, once the
/// photos are read it offers the order check for the shelf they look like.
struct ShelfCheckView: View {
  /// The shelf whose order to check, or nil to check the catalogue.
  let shelfID: String?

  @Environment(Library.self) private var library
  @Environment(Toasts.self) private var toasts
  @Environment(Router.self) private var router
  @State private var model = ShelfCheckModel()
  @State private var picked: [PhotosPickerItem] = []
  @State private var cameraOpen = false
  @State private var confirmingClear = false
  @State private var showsCatalogued = false
  /// Without a fixed shelf: showing the order check rather than the
  /// catalogue check, and for which shelf (nil follows the guess).
  @State private var showsOrder = false
  @State private var pickedShelfID: String?

  private let cameraAvailable = ShelfCheckCamera.isAvailable

  init(shelfID: String? = nil) {
    self.shelfID = shelfID
  }

  private var shelves: [Shelf] { library.settings?.shelves ?? [] }
  /// The shelf this screen was opened for, while it still exists.
  private var fixedShelf: Shelf? { shelfID.flatMap { id in shelves.first { $0.id == id } } }

  var body: some View {
    Group {
      if model.isEmpty {
        emptyState
      } else {
        results
      }
    }
    .navigationTitle(fixedShelf == nil ? "Shelf check" : "Check order")
    .navigationSubtitle(fixedShelf?.name ?? "")
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      if !model.isEmpty {
        ToolbarItem(placement: .topBarTrailing) {
          Button("Start over", systemImage: "arrow.counterclockwise") { confirmingClear = true }
            .confirmationDialog(
              "Start over?", isPresented: $confirmingClear, titleVisibility: .visible
            ) {
              Button("Clear photos and results", role: .destructive) {
                model.removeAll()
                showsOrder = false
                pickedShelfID = nil
              }
              Button("Cancel", role: .cancel) {}
            } message: {
              Text("This clears every photo and what was read from them.")
            }
        }
      }
    }
    .onChange(of: picked) { _, items in
      guard !items.isEmpty else { return }
      model.add(items, api: library.api, toasts: toasts)
      picked = []
    }
    .fullScreenCover(isPresented: $cameraOpen) {
      ShelfCheckCamera { image in
        model.add(image, api: library.api, toasts: toasts)
      }
      .ignoresSafeArea()
    }
    .sensoryFeedback(trigger: model.lastFinish) { _, finish in
      finish.succeeded ? .success : .error
    }
    // Read a shelf's photos in its direction.
    .task(id: fixedShelf?.orientation) {
      if let fixedShelf { model.arrangement = fixedShelf.orientation ?? .upright }
    }
  }

  // MARK: Empty

  private var emptyState: some View {
    // Captured for the `PhotosPicker` label, which is built off the main actor.
    let onAccent = Color.onAccent
    return ContentUnavailableView {
      if let fixedShelf {
        Label("Check the order of “\(fixedShelf.name)”", systemImage: "arrow.left.arrow.right")
      } else {
        Label("Check a shelf photo", systemImage: "text.viewfinder")
      }
    } description: {
      if let fixedShelf {
        Text(orderInstructions(for: fixedShelf))
      } else {
        Text(
          "Photograph a shelf of discs and Spine reads the spines, then lists the ones that aren’t in your collection yet — and any you own in another format. Take a photo of each shelf, or choose several at once."
        )
      }
    } actions: {
      if cameraAvailable {
        Button {
          cameraOpen = true
        } label: {
          Label("Take Photo", systemImage: "camera")
            .foregroundStyle(.onAccent)
        }
        .buttonStyle(.glassProminent)
        PhotosPicker(selection: $picked, maxSelectionCount: 10, matching: .images) {
          Label("Choose Photos", systemImage: "photo.on.rectangle")
        }
        .buttonStyle(.glass)
      } else {
        PhotosPicker(selection: $picked, maxSelectionCount: 10, matching: .images) {
          Label("Choose Photos", systemImage: "photo.on.rectangle")
            .foregroundStyle(onAccent)
        }
        .buttonStyle(.glassProminent)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(Color.spineBackground.ignoresSafeArea())
  }

  private func orderInstructions(for shelf: Shelf) -> String {
    shelf.isStacked
      ? "Photograph the pile from the top disc down to the bottom one — in order, across several photos if it doesn’t fit in one. Spine checks each disc against the shelf’s order and says what to move."
      : "Photograph the shelf from its left end to its right — in order, across several photos if it doesn’t fit in one. Spine checks each disc against the shelf’s order and says what to move."
  }

  // MARK: Results

  private var results: some View {
    let entries = model.entries
    let failed = model.photos.enumerated().compactMap { index, photo in
      if case .failed(let message) = photo.phase { (number: index + 1, photo: photo, message: message) } else { nil }
    }
    let readAny = model.photos.contains { $0.phase == .read }
    let raw = model.readSpines
    let guess =
      fixedShelf == nil
      ? ShelfOrder.guessPhotographedShelf(raw, films: library.films, shelves: shelves) : nil
    let orderShelf =
      fixedShelf
      ?? (showsOrder ? (pickedShelfID.flatMap { id in shelves.first { $0.id == id } } ?? guess) : nil)
    let check = orderShelf.map {
      ShelfOrder.check(raw, shelf: $0, films: library.films, shelves: shelves)
    }

    return List {
      Section {
        ShelfCheckPhotoStrip(
          photos: model.photos, preparing: model.preparing,
          retry: { model.retry($0, api: library.api) },
          remove: { model.remove($0, api: library.api) })
        .listRowInsets(EdgeInsets(top: 12, leading: 16, bottom: 12, trailing: 16))
        if let reading = model.reading {
          ShelfCheckProgressRow(number: reading.number, total: model.photos.count, since: reading.since)
        } else if model.preparing > 0 {
          ShelfCheckProgressRow(preparing: model.preparing)
        }
      } header: {
        Text("Photos")
      } footer: {
        if let fixedShelf {
          Text(
            fixedShelf.isStacked
              ? "Top to bottom, in order — overlapping photos are fine."
              : "Left to right, in order — overlapping photos are fine.")
        }
      }
      .listRowBackground(Color.spineCard)

      if !failed.isEmpty {
        Section("Couldn’t read") {
          ForEach(failed, id: \.photo.id) { failure in
            ShelfCheckFailureRow(number: failure.number, message: failure.message) {
              model.retry(failure.photo.id, api: library.api)
            }
          }
        }
        .listRowBackground(Color.spineCard)
      }

      if fixedShelf == nil, readAny, let guess {
        orderToggle(guess: guess, shown: orderShelf)
      }

      if let check, readAny {
        ShelfOrderSections(
          check: check,
          added: addedCopy,
          onAdd: add,
          onMarkArranged: { markArranged(check.shelf) })
      } else {
        catalogueSections(entries)
      }

      if readAny, model.isIdle, entries.isEmpty {
        Section {
          Text("No disc spines found. Try a straighter, closer photo with the spines in focus.")
            .font(.subheadline)
            .foregroundStyle(.spineMutedForeground)
        }
        .listRowBackground(Color.spineCard)
      }
    }
    .listStyle(.insetGrouped)
    .spineScreenBackground()
    .animation(.default, value: entries.map(\.id))
    .animation(.default, value: failed.map(\.photo.id))
    .animation(.default, value: showsOrder)
    .safeAreaBar(edge: .bottom) { addBar }
  }

  /// Without a fixed shelf: the offer to check the guessed shelf's order,
  /// or — once it's showing — the shelf picker and the way back.
  private func orderToggle(guess: Shelf, shown: Shelf?) -> some View {
    Section {
      if let shown {
        Picker("Shelf", selection: shelfSelection(default: shown.id)) {
          ForEach(shelves) { shelf in
            Text(shelf.name).tag(shelf.id)
          }
        }
        Button("Show What’s Missing Instead", systemImage: "text.viewfinder") {
          showsOrder = false
        }
      } else {
        VStack(alignment: .leading, spacing: 10) {
          Text("Looks like **\(ShelfOrderWords.shelfPhrase(guess.name))** — check its order?")
            .font(.subheadline)
            .foregroundStyle(.spineForeground)
          Button {
            pickedShelfID = nil
            showsOrder = true
          } label: {
            HStack(spacing: 6) {
              Image(systemName: "arrow.left.arrow.right")
              Text("Check Order")
            }
            .font(.subheadline.weight(.semibold))
          }
          .buttonStyle(.glass)
        }
        .padding(.vertical, 4)
      }
    } header: {
      Text("Shelf order")
    } footer: {
      if shown != nil {
        Text(
          "These photos look like “\(guess.name)”. Spines are checked in the order they were read — left to right, or top to bottom for a pile."
        )
      }
    }
    .listRowBackground(Color.spineCard)
  }

  private func shelfSelection(default id: String) -> Binding<String> {
    Binding(get: { pickedShelfID ?? id }, set: { pickedShelfID = $0 })
  }

  @ViewBuilder
  private func catalogueSections(_ entries: [ShelfCheckResults.Entry]) -> some View {
    let sections = ShelfCheckResults.sections(entries, films: library.films)

    if !sections.missing.isEmpty {
      Section {
        ForEach(sections.missing) { entry in
          if let added = entry.added {
            NavigationLink(value: Route.film(id: added.id)) {
              ShelfCheckMissingRow(spine: entry.spine, added: true, add: {})
            }
          } else {
            ShelfCheckMissingRow(spine: entry.spine, added: false) {
              add(entry.spine)
            }
          }
        }
      } header: {
        ShelfCheckSectionHeader(title: "Not in your collection", count: sections.missing.count)
      }
      .listRowBackground(Color.spineCard)
    }

    if !sections.otherFormat.isEmpty {
      Section {
        ForEach(sections.otherFormat) { entry in
          if let film = entry.spine.film {
            // Once a copy in the spine's format is added, open that one.
            NavigationLink(value: Route.film(id: entry.added?.id ?? film.id)) {
              ShelfCheckOtherFormatRow(
                spine: entry.spine, film: film, current: library.film(id: film.id),
                added: entry.added != nil)
            }
          }
        }
      } header: {
        ShelfCheckSectionHeader(title: "In another format", count: sections.otherFormat.count)
      }
      .listRowBackground(Color.spineCard)
    }

    if !sections.owned.isEmpty {
      Section {
        DisclosureGroup(isExpanded: $showsCatalogued) {
          ForEach(sections.owned) { entry in
            if let film = entry.spine.film {
              NavigationLink(value: Route.film(id: film.id)) {
                ShelfCheckOwnedRow(film: film, current: library.film(id: film.id))
              }
            }
          }
        } label: {
          HStack {
            Label("Already catalogued", systemImage: "checkmark.circle")
              .foregroundStyle(.spineForeground)
            Spacer()
            Text(sections.owned.count, format: .number)
              .monospacedDigit()
              .foregroundStyle(.spineMutedForeground)
          }
        }
      }
      .listRowBackground(Color.spineCard)
    }
  }

  /// Take or pick more photos — they join the reading queue.
  private var addBar: some View {
    let onAccent = Color.onAccent
    return GlassEffectContainer(spacing: 12) {
      HStack(spacing: 12) {
        if cameraAvailable {
          Button {
            cameraOpen = true
          } label: {
            Label("Take Photo", systemImage: "camera")
              .font(.headline)
              .foregroundStyle(.onAccent)
              .frame(maxWidth: .infinity)
              .padding(.vertical, 6)
          }
          .buttonStyle(.glassProminent)
          PhotosPicker(selection: $picked, maxSelectionCount: 10, matching: .images) {
            Label("Add Photos", systemImage: "photo.on.rectangle")
              .font(.headline)
              .frame(maxWidth: .infinity)
              .padding(.vertical, 6)
          }
          .buttonStyle(.glass)
        } else {
          PhotosPicker(selection: $picked, maxSelectionCount: 10, matching: .images) {
            Label("Add Photos", systemImage: "photo.on.rectangle")
              .font(.headline)
              .foregroundStyle(onAccent)
              .frame(maxWidth: .infinity)
              .padding(.vertical, 6)
          }
          .buttonStyle(.glassProminent)
        }
      }
    }
    .tint(.lbGreen)
    .frame(maxWidth: 560)
    .padding(.horizontal, 20)
    .padding(.bottom, 8)
  }

  // MARK: Actions

  /// The copy of an uncatalogued spine added since it was read.
  private func addedCopy(_ spine: ShelfSpine) -> Film? {
    ShelfCheckResults.addedSince(spine, films: library.films)
  }

  /// The Add sheet, searching Blu-ray.com for the spine and with its title
  /// filled in. After adding, the sheet closes back to this screen.
  private func add(_ spine: ShelfSpine) {
    let query = [spine.title, spine.year.map(String.init)].compactMap { $0 }.joined(separator: " ")
    router.sheet = .addFilm(
      scan: false,
      prefill: AddFilmPrefill(query: query, title: spine.title, year: spine.year, format: spine.format),
      staysOnAdd: true)
  }

  /// Everything's where it should be: clear the shelf's NEW flags.
  private func markArranged(_ shelf: Shelf) {
    let now = JSONCoding.isoString(Date())
    let next = shelves.map { other in
      guard other.id == shelf.id else { return other }
      var other = other
      other.arrangedAt = now
      return other
    }
    Task {
      do {
        try await library.saveShelves(next)
        toasts.success("Shelf marked arranged")
      } catch {
        toasts.error(error)
      }
    }
  }
}
