import SwiftUI

/// A wishlist item being added — scraped from a retailer page or typed in.
/// Fields are kept as text, as on the web, and cleaned up on save.
struct WishlistDraft: Identifiable {
  let id = UUID()
  var title = ""
  var year = ""
  var format = "Blu-ray"
  var url = ""
  var retailer = ""
  var price = ""
  var coverUrl = ""
  var notes = ""
  /// Opened from a pasted link (scraped, or a failed scrape to finish by
  /// hand) rather than "Add manually".
  var fromLink = false
}

/// "Add to wishlist": check the scraped details, fill any gaps, save.
struct WishlistDraftSheet: View {
  @Environment(Library.self) private var library
  @Environment(Toasts.self) private var toasts
  @Environment(\.dismiss) private var dismiss

  @State private var draft: WishlistDraft
  @State private var saving = false
  @FocusState private var focus: Field?
  /// Called after a successful save (the tab clears its link field).
  private let onAdded: () -> Void

  private enum Field: Hashable { case title, year, retailer, price, url, cover, notes }

  init(draft: WishlistDraft, onAdded: @escaping () -> Void) {
    _draft = State(initialValue: draft)
    self.onAdded = onAdded
  }

  private var title: String { draft.title.draftTrimmed }
  private var yearValue: Int? { Int(draft.year.draftTrimmed) }
  /// The server accepts 1878–2100; empty is fine.
  private var yearIsValid: Bool {
    draft.year.draftTrimmed.isEmpty || yearValue.map { (1878...2100).contains($0) } == true
  }
  private var canSave: Bool { !title.isEmpty && yearIsValid && !saving }
  private var coverPreview: URL? {
    guard let url = CoverURL.resolve(draft.coverUrl),
      let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https"
    else { return nil }
    return url
  }

  var body: some View {
    NavigationStack {
      Form {
        Section {
          TextField("Title", text: $draft.title, prompt: Text("Title (required)"), axis: .vertical)
            .font(.headline)
            .focused($focus, equals: .title)
            .submitLabel(.next)
            .lineLimit(1...4)
        } header: {
          if let coverPreview {
            PosterFrame(url: coverPreview, title: title, cornerRadius: 8, maxPixelSize: 600)
              .frame(width: 132)
              .shadow(color: .black.opacity(0.4), radius: 14, y: 6)
              .frame(maxWidth: .infinity)
              .padding(.bottom, 16)
              .textCase(nil)
              .accessibilityLabel("Cover preview")
          }
        } footer: {
          if draft.fromLink {
            Text("Check the scraped details before saving.")
          }
        }
        .listRowBackground(Color.spineCard)

        Section {
          WishlistDraftField("Year", text: $draft.year, prompt: "e.g. 1985")
            .keyboardType(.numberPad)
            .focused($focus, equals: .year)
          Picker("Format", selection: $draft.format) {
            ForEach(FilmVocabulary.formats, id: \.self) { Text($0).tag($0) }
          }
          .pickerStyle(.menu)
        } footer: {
          if !yearIsValid {
            Text("Enter a year between 1878 and 2100.")
              .foregroundStyle(.spineDestructive)
          }
        }
        .listRowBackground(Color.spineCard)

        Section("Where to buy") {
          WishlistDraftField("Retailer", text: $draft.retailer, prompt: "e.g. Zavvi")
            .focused($focus, equals: .retailer)
          WishlistDraftField("Price", text: $draft.price, prompt: "£24.99")
            .focused($focus, equals: .price)
          WishlistDraftField("Link", text: $draft.url, prompt: "https://…")
            .keyboardType(.URL)
            .textContentType(.URL)
            .focused($focus, equals: .url)
        }
        .listRowBackground(Color.spineCard)

        Section {
          WishlistDraftField("Cover URL", text: $draft.coverUrl, prompt: "https://…")
            .keyboardType(.URL)
            .focused($focus, equals: .cover)
        }
        .listRowBackground(Color.spineCard)

        Section("Notes") {
          TextField(
            "Notes", text: $draft.notes, prompt: Text("e.g. Wait for the sale"), axis: .vertical
          )
          .lineLimit(2...6)
          .focused($focus, equals: .notes)
        }
        .listRowBackground(Color.spineCard)
      }
      .formStyle(.grouped)
      .listSectionSpacing(.compact)
      .tint(.lbGreen)
      .scrollDismissesKeyboard(.interactively)
      .spineScreenBackground()
      .navigationTitle("Add to wishlist")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel", role: .cancel) { dismiss() }
            .disabled(saving)
        }
        ToolbarItem(placement: .confirmationAction) {
          if saving {
            ProgressView()
          } else {
            Button("Save", action: save)
              .fontWeight(.semibold)
              .disabled(!canSave)
              .accessibilityLabel("Save to wishlist")
          }
        }
      }
      .onAppear {
        if title.isEmpty { focus = .title }
      }
    }
    .presentationDetents([.large])
    .presentationBackground(Color.spineBackground)
    .interactiveDismissDisabled(saving)
  }

  private func save() {
    guard canSave else { return }
    saving = true
    let input = WishlistInput(
      title: title,
      year: yearValue,
      format: draft.format,
      url: draft.url.draftValue,
      retailer: draft.retailer.draftValue,
      price: draft.price.draftValue,
      coverUrl: draft.coverUrl.draftValue,
      notes: draft.notes.draftValue)
    Task {
      defer { saving = false }
      do {
        try await library.addToWishlist(input)
        toasts.success("Added to wishlist")
        onAdded()
        dismiss()
      } catch is CancellationError {
      } catch APIError.unauthorized {
      } catch APIError.transport(let message) {
        toasts.error(message)
      } catch {
        toasts.error("Could not add — a title is required")
      }
    }
  }
}

/// A labelled text row: the label leading, the value trailing.
private struct WishlistDraftField: View {
  let label: String
  @Binding var text: String
  let prompt: String

  init(_ label: String, text: Binding<String>, prompt: String) {
    self.label = label
    self._text = text
    self.prompt = prompt
  }

  // Not LabeledContent: that stacks the row when a long link doesn't fit,
  // and every row should read label-left, value-right.
  var body: some View {
    HStack(spacing: 16) {
      Text(label)
        .foregroundStyle(.spineForeground)
        .layoutPriority(1)
      TextField(label, text: $text, prompt: Text(prompt))
        .multilineTextAlignment(.trailing)
        .foregroundStyle(.spineMutedForeground)
        .textInputAutocapitalization(label == "Retailer" ? .words : .never)
        .autocorrectionDisabled()
    }
  }
}

extension String {
  fileprivate var draftTrimmed: String { trimmingCharacters(in: .whitespacesAndNewlines) }
  /// Trimmed, or nil when blank — the web sends `field || null`.
  fileprivate var draftValue: String? { draftTrimmed.isEmpty ? nil : draftTrimmed }
}
