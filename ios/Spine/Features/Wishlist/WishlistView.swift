import SwiftUI

/// The Wishlist tab (src/routes/_app/wishlist.tsx): paste a retailer link to
/// scrape a product page into a draft, or add one by hand; "Bought it" moves
/// an item into the collection.
struct WishlistView: View {
  @Environment(Library.self) private var library
  @Environment(Toasts.self) private var toasts
  @Environment(Router.self) private var router

  @State private var link = ""
  @State private var scraping = false
  @State private var draft: WishlistDraft?
  /// Items being moved or removed — hidden at once, restored on failure.
  @State private var hidden: Set<String> = []
  /// The film a "Bought it" just created, offered for opening.
  @State private var justMoved: Film?
  @FocusState private var linkFocused: Bool

  private var trimmedLink: String { link.trimmingCharacters(in: .whitespacesAndNewlines) }
  private var items: [WishlistItem] { library.wishlist.filter { !hidden.contains($0.id) } }

  var body: some View {
    NavigationStack(path: router.path(for: .wishlist)) {
      content
        .navigationTitle("Wishlist")
        .toolbar {
          ToolbarItem(placement: .topBarTrailing) {
            Button("Add manually", systemImage: "plus") { draft = WishlistDraft() }
          }
          ToolbarSpacer(.fixed, placement: .topBarTrailing)
          AccountButton()
        }
        .routeDestinations()
    }
    .sheet(item: $draft) { draft in
      WishlistDraftSheet(draft: draft) { link = "" }
    }
  }

  @ViewBuilder private var content: some View {
    if !library.hasLoadedWishlist {
      if let error = library.loadError {
        LoadFailedView(message: error) { await library.refreshAll() }
      } else {
        LoadingView()
      }
    } else {
      list
    }
  }

  private var list: some View {
    List {
      Section {
        linkField
      } header: {
        Text("Add from a link")
      } footer: {
        Text(
          "Paste a product link from a supported retailer — HMV, Zavvi, Amazon, Arrow, Criterion, Indicator, Eureka, BFI and more."
        )
      }
      .listRowBackground(Color.spineCard)

      if items.isEmpty {
        Section {
          ContentUnavailableView {
            Label("Nothing on the wishlist", systemImage: "heart")
          } description: {
            Text("Paste a retailer link above to start tracking releases you want.")
          } actions: {
            Button {
              draft = WishlistDraft()
            } label: {
              Label("Add manually", systemImage: "plus")
                .labelStyle(.titleAndIcon)
                .fontWeight(.semibold)
            }
            .buttonStyle(.glass)
            .fixedSize()
          }
        }
        .listRowBackground(Color.clear)
      } else {
        Section {
          ForEach(items) { item in
            WishlistItemRow(item: item) { move(item) }
              .listRowBackground(Color.spineCard)
              .swipeActions(edge: .leading) {
                Button {
                  move(item)
                } label: {
                  Label("Bought it", systemImage: "checkmark.circle.fill")
                }
                .tint(.lbGreen)
              }
              .swipeActions(edge: .trailing) {
                Button(role: .destructive) {
                  remove(item)
                } label: {
                  Label("Remove", systemImage: "trash")
                }
              }
              .contextMenu { menu(for: item) }
          }
        } header: {
          Text(Formatters.count(items.count, "release"))
        }
      }
    }
    .listStyle(.insetGrouped)
    .spineScreenBackground()
    .scrollDismissesKeyboard(.interactively)
    .refreshable {
      do { try await library.refreshWishlist() } catch { toasts.error(error) }
    }
    .animation(.default, value: items.map(\.id))
    .safeAreaInset(edge: .bottom) {
      if let film = justMoved {
        WishlistMovedBanner(film: film) {
          withAnimation { justMoved = nil }
          router.popToRoot(.collection)
          router.open(.film(id: film.id), in: .collection)
        } dismiss: {
          withAnimation { justMoved = nil }
        }
        .transition(.move(edge: .bottom).combined(with: .opacity))
      }
    }
    .task(id: justMoved?.id) {
      guard justMoved != nil else { return }
      try? await Task.sleep(for: .seconds(8))
      guard !Task.isCancelled else { return }
      withAnimation { justMoved = nil }
    }
  }

  // MARK: Link field

  private var linkField: some View {
    HStack(spacing: 10) {
      Image(systemName: "link")
        .foregroundStyle(.spineMutedForeground)
        .accessibilityHidden(true)
      TextField(
        "Product link", text: $link,
        prompt: Text(verbatim: "https://www.criterion.com/films/…")
      )
      .keyboardType(.URL)
      .textContentType(.URL)
      .textInputAutocapitalization(.never)
      .autocorrectionDisabled()
      .submitLabel(.go)
      .focused($linkFocused)
      .onSubmit(fetch)
      .disabled(scraping)
      if scraping {
        HStack(spacing: 6) {
          ProgressView()
          Text("Scraping…")
            .font(.subheadline)
            .foregroundStyle(.spineMutedForeground)
        }
      } else if trimmedLink.isEmpty {
        PasteButton(payloadType: URL.self) { urls in
          guard let url = urls.first else { return }
          link = url.absoluteString
          fetch()
        }
        .labelStyle(.iconOnly)
        .buttonBorderShape(.capsule)
        .controlSize(.small)
      } else {
        Button(action: fetch) {
          Text("Fetch details").foregroundStyle(.onAccent)
        }
        .buttonStyle(.glassProminent)
        .controlSize(.small)
        .fontWeight(.semibold)
      }
    }
    .animation(.default, value: scraping)
    .animation(.default, value: trimmedLink.isEmpty)
  }

  // MARK: Actions

  /// Scrape the pasted link into a draft. A failed scrape still opens the
  /// draft with the link and any detected retailer, so the item can be
  /// filled in by hand.
  private func fetch() {
    let url = trimmedLink
    guard !url.isEmpty, !scraping else { return }
    linkFocused = false
    scraping = true
    Task {
      defer { scraping = false }
      do {
        switch try await library.api.scrapeWishlistUrl(url) {
        case .success(let product):
          draft = WishlistDraft(
            title: product.title, url: product.url, retailer: product.retailer,
            price: product.price ?? "", coverUrl: product.imageUrl ?? "", fromLink: true)
        case .failure(let message, let retailer):
          toasts.error(message)
          draft = WishlistDraft(url: url, retailer: retailer ?? "", fromLink: true)
        }
      } catch {
        guard toasts.wishlistFailure(error, fallback: "Scrape failed — add the item manually")
        else {
          return
        }
        draft = WishlistDraft(url: url, fromLink: true)
      }
    }
  }

  private func move(_ item: WishlistItem) {
    guard !hidden.contains(item.id) else { return }
    hidden.insert(item.id)
    Task {
      defer { hidden.remove(item.id) }
      do {
        if let film = try await library.moveToCollection(id: item.id) {
          toasts.success("“\(film.title)” moved to your collection")
          withAnimation(.spring(duration: 0.4)) { justMoved = film }
        }
      } catch {
        toasts.wishlistFailure(error, fallback: "Could not move to collection")
      }
    }
  }

  private func remove(_ item: WishlistItem) {
    guard !hidden.contains(item.id) else { return }
    hidden.insert(item.id)
    Task {
      defer { hidden.remove(item.id) }
      do {
        try await library.removeFromWishlist(id: item.id)
      } catch {
        toasts.wishlistFailure(error, fallback: "Could not remove “\(item.title)”")
      }
    }
  }

  @ViewBuilder private func menu(for item: WishlistItem) -> some View {
    Button {
      move(item)
    } label: {
      Label("Bought it — move to collection", systemImage: "checkmark.circle")
    }
    if let url = item.link {
      Link(destination: url) {
        Label("Open retailer page", systemImage: "safari")
      }
      ShareLink(item: url) {
        Label("Share link", systemImage: "square.and.arrow.up")
      }
    }
    Divider()
    Button(role: .destructive) {
      remove(item)
    } label: {
      Label("Remove from wishlist", systemImage: "trash")
    }
  }
}

// MARK: - Row

/// One wishlist release: cover, title, year and format, retailer and price,
/// notes, and the buy / open-link actions.
private struct WishlistItemRow: View {
  let item: WishlistItem
  let onMove: () -> Void

  var body: some View {
    HStack(alignment: .top, spacing: 14) {
      PosterFrame(url: item.cover, title: item.title, cornerRadius: 5, maxPixelSize: 300)
        .frame(width: 72)
        .accessibilityHidden(true)

      VStack(alignment: .leading, spacing: 10) {
        details
          .accessibilityElement(children: .combine)
        actions
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .padding(.vertical, 4)
  }

  private var details: some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(item.title)
        .font(.headline)
        .foregroundStyle(.spineForeground)
        .lineLimit(2)

      if item.year != nil || item.format != nil {
        HStack(spacing: 6) {
          if let year = item.year {
            Text(String(year))
              .font(.subheadline)
              .foregroundStyle(.spineMutedForeground)
          }
          if let format = item.format { FormatBadge(format: format) }
        }
      }

      if item.retailer != nil || item.price != nil {
        HStack(spacing: 8) {
          if let retailer = item.retailer, !retailer.isEmpty {
            Tag(text: retailer)
          }
          if let price = item.price, !price.isEmpty {
            Text(price)
              .font(.subheadline.weight(.semibold).monospacedDigit())
              .foregroundStyle(.lbOrange)
          }
        }
      }

      if let notes = item.notes, !notes.isEmpty {
        Text(notes)
          .font(.footnote)
          .foregroundStyle(.spineMutedForeground)
          .lineLimit(2)
      }
    }
  }

  private var actions: some View {
    HStack(spacing: 8) {
      Button(action: onMove) {
        Label("Bought it", systemImage: "checkmark.circle")
          .font(.subheadline.weight(.semibold))
      }
      .buttonStyle(.glass)
      .controlSize(.small)
      .accessibilityHint("Moves it from your wishlist into your collection")

      if let url = item.link {
        Link(destination: url) {
          Image(systemName: "arrow.up.right")
            .font(.subheadline.weight(.semibold))
        }
        .buttonStyle(.glass)
        .buttonBorderShape(.circle)
        .controlSize(.small)
        .accessibilityLabel("Open retailer page")
      }
    }
  }
}

// MARK: - Moved banner

/// After "Bought it": a floating glass bar that opens the new film in the
/// Collection tab. Dismisses itself after a few seconds.
private struct WishlistMovedBanner: View {
  let film: Film
  let open: () -> Void
  let dismiss: () -> Void

  var body: some View {
    HStack(spacing: 12) {
      PosterFrame(url: film.coverURL, title: "", cornerRadius: 3, maxPixelSize: 120)
        .frame(width: 30)
        .accessibilityHidden(true)
      VStack(alignment: .leading, spacing: 1) {
        Text("Now in your collection")
          .font(.caption)
          .foregroundStyle(.spineMutedForeground)
        Text(film.title)
          .font(.subheadline.weight(.semibold))
          .foregroundStyle(.spineForeground)
          .lineLimit(1)
      }
      .accessibilityElement(children: .combine)
      Spacer(minLength: 4)
      Button(action: open) {
        Text("Open").foregroundStyle(.onAccent)
      }
      .buttonStyle(.glassProminent)
      .fontWeight(.semibold)
      .accessibilityLabel("Open \(film.title)")
      Button(action: dismiss) {
        Image(systemName: "xmark")
          .font(.footnote.weight(.bold))
          .foregroundStyle(.spineMutedForeground)
          .frame(width: 28, height: 28)
          .contentShape(.circle)
      }
      .buttonStyle(.plain)
      .accessibilityLabel("Dismiss")
    }
    .padding(.leading, 10)
    .padding(.trailing, 8)
    .padding(.vertical, 8)
    .glassEffect(.regular, in: .rect(cornerRadius: 22))
    .frame(maxWidth: 520)
    .padding(.horizontal, 16)
    .padding(.bottom, 8)
  }
}

// MARK: - Helpers

extension WishlistItem {
  fileprivate var link: URL? {
    url.flatMap { URL(string: $0.trimmingCharacters(in: .whitespaces)) }
      .flatMap { $0.scheme == nil ? URL(string: "https://\($0.absoluteString)") : $0 }
  }

  fileprivate var cover: URL? {
    coverUrl.flatMap { URL(string: $0.trimmingCharacters(in: .whitespaces)) }
  }
}

extension Toasts {
  /// Shows a thrown failure with the web's fallback message: offline and
  /// timeout messages say more than the fallback, so those win. Returns
  /// false for a cancellation or an expired session, which show nothing.
  @discardableResult
  fileprivate func wishlistFailure(_ error: Error, fallback: String) -> Bool {
    if error is CancellationError || (error as? APIError) == .unauthorized { return false }
    if case .transport(let message)? = error as? APIError {
      self.error(message)
    } else {
      self.error(fallback)
    }
    return true
  }
}
