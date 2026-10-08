import SwiftUI

/// The text fields of a film form screen, for moving the keyboard between
/// them (`importQuery` is the add sheet's search-or-link field).
enum FilmFormFocus: Hashable {
  case importQuery, coverUrl, title, director, year, runtime, audio, label, edition,
    spine, barcode, price, tmdb, notes
}

/// The add/edit form's sections, to embed in a `Form` — the web's
/// `FilmForm` (src/components/film-form.tsx): a cover with the Blu-ray.com
/// cover search, then every disc field, then notes.
struct FilmFormSections: View {
  @Binding var values: FilmFormValues
  var focus: FocusState<FilmFormFocus?>.Binding
  /// An id on the first row, for `ScrollViewReader` to bring the form into
  /// sight after an import.
  var anchorID: String? = nil

  @Environment(Library.self) private var library
  @Environment(Toasts.self) private var toasts
  @State private var coverSearchOpen = false
  @State private var spineLookupPending = false

  var body: some View {
    Section("Cover") {
      HStack(alignment: .center, spacing: 16) {
        PosterFrame(
          url: URL(string: values.coverUrl.trimmingCharacters(in: .whitespaces)),
          title: values.title.isEmpty ? "No cover" : values.title,
          cornerRadius: 6, maxPixelSize: 360
        )
        .frame(width: 84)
        .accessibilityLabel(values.coverUrl.isEmpty ? "No cover" : "Cover preview")

        VStack(alignment: .leading, spacing: 6) {
          Button {
            coverSearchOpen = true
          } label: {
            Label("Find cover on Blu-ray.com", systemImage: "photo.on.rectangle.angled")
              .font(.subheadline.weight(.semibold))
          }
          .buttonStyle(.borderless)
          Text("Picking a release sets the cover and fills a blank title and year.")
            .font(.caption)
            .foregroundStyle(.spineMutedForeground)
            .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
      }
      .alignmentGuide(.listRowSeparatorLeading) { $0[.leading] }
      .padding(.vertical, 4)
      .id(anchorID)
      .sheet(isPresented: $coverSearchOpen) {
        FilmCoverSearchSheet(defaultQuery: coverQuery) { result in
          values.coverUrl = result.coverUrl
          if values.title.isEmpty { values.title = FilmImport.cleanBlurayTitle(result.title) }
          if values.year.isEmpty { values.year = result.year.map(String.init) ?? "" }
        }
      }

      FilmFormTextRow(
        "Cover URL", text: $values.coverUrl, prompt: "https://…", keyboard: .URL,
        plain: true, focus: focus, field: .coverUrl)
    }
    .listRowBackground(Color.spineCard)

    Section("Film") {
      FilmFormTextRow(
        "Title", text: $values.title, prompt: "Required", capitalization: .words,
        focus: focus, field: .title)
      FilmFormTextRow(
        "Director", text: $values.director, capitalization: .words,
        focus: focus, field: .director)
      FilmFormTextRow(
        "Year", text: $values.year, keyboard: .numberPad, focus: focus, field: .year)
      FilmFormTextRow(
        "Runtime (minutes)", text: $values.runtimeMinutes, keyboard: .numberPad,
        focus: focus, field: .runtime)
    }
    .listRowBackground(Color.spineCard)

    Section("Disc") {
      Picker("Format", selection: $values.format) {
        ForEach(Self.options(FilmVocabulary.formats, current: values.format), id: \.self) {
          Text($0).tag($0)
        }
      }
      Picker("HDR", selection: hdrSelection) {
        ForEach(Self.options(FilmVocabulary.hdrTypes, current: hdrSelection.wrappedValue), id: \.self) {
          Text($0).tag($0)
        }
      }
      FilmFormTextRow(
        "Audio", text: $values.audio, prompt: "e.g. DTS-HD MA 5.1", plain: true,
        focus: focus, field: .audio)
      optionalPicker("Region", selection: $values.region, options: FilmVocabulary.regions)
      Stepper(value: discCount, in: 1...99) {
        LabeledContent("Disc count") {
          Text(discCount.wrappedValue, format: .number)
            .monospacedDigit()
            .foregroundStyle(.spineForeground)
        }
      }
    }
    .listRowBackground(Color.spineCard)

    Section("Release") {
      FilmFormTextRow(
        "Publisher / Label", text: $values.label, prompt: "e.g. Criterion, Arrow",
        capitalization: .words, focus: focus, field: .label)
      optionalPicker("Package type", selection: $values.packageType, options: FilmVocabulary.packageTypes)
      FilmFormTextRow(
        "Edition", text: $values.edition, prompt: "e.g. Limited Edition",
        capitalization: .words, focus: focus, field: .edition)
      LabeledContent {
        HStack(spacing: 10) {
          TextField("Criterion spine #", text: $values.spineNumber, prompt: Text("—"))
            .multilineTextAlignment(.trailing)
            .keyboardType(.numberPad)
            .focused(focus, equals: .spine)
          Button(action: lookUpSpine) {
            if spineLookupPending {
              ProgressView().controlSize(.small)
            } else {
              Image(systemName: "sparkles")
            }
          }
          .buttonStyle(.glass)
          .buttonBorderShape(.circle)
          .tint(.lbBlue)
          .disabled(!values.hasTitle || spineLookupPending)
          .accessibilityLabel("Look up spine number on criterion.com")
        }
      } label: {
        Text("Criterion spine #")
      }
    }
    .listRowBackground(Color.spineCard)

    Section("Purchase") {
      FilmFormTextRow(
        "Barcode (UPC/EAN)", text: $values.barcode, keyboard: .numberPad,
        focus: focus, field: .barcode)
      FilmFormTextRow(
        "Price paid", text: $values.pricePaid, prompt: "e.g. 14.99", keyboard: .decimalPad,
        focus: focus, field: .price)
    }
    .listRowBackground(Color.spineCard)

    Section {
      FilmFormTextRow(
        "TMDB ID or URL", text: $values.tmdbId, prompt: "e.g. tv/60573", keyboard: .URL,
        plain: true, focus: focus, field: .tmdb)
    } header: {
      Text("Matching")
    } footer: {
      Text("Fixes a wrong match. Takes “movie/603”, “tv/60573”, a themoviedb.org link, or a bare id.")
    }
    .listRowBackground(Color.spineCard)

    Section("Notes") {
      TextField("Notes", text: $values.notes, prompt: Text("Anything worth remembering"), axis: .vertical)
        .lineLimit(3...10)
        .focused(focus, equals: .notes)
    }
    .listRowBackground(Color.spineCard)
  }

  /// The cover search starts from the title and year, as on the web.
  private var coverQuery: String {
    [values.title, values.year].filter { !$0.isEmpty }.joined(separator: " ")
  }

  /// An empty HDR shows as SDR; picking SDR stores "SDR", which the input
  /// conversion turns back into no HDR.
  private var hdrSelection: Binding<String> {
    Binding(
      get: { values.hdr.isEmpty ? "SDR" : values.hdr },
      set: { values.hdr = $0 })
  }

  private var discCount: Binding<Int> {
    Binding(
      get: { max(1, FilmFormValues.parseInt(values.discCount) ?? 1) },
      set: { values.discCount = String($0) })
  }

  /// A picker over a vocabulary that can also be left unset.
  private func optionalPicker(
    _ title: String, selection: Binding<String>, options: [String]
  ) -> some View {
    Picker(title, selection: selection) {
      Text("Not set").tag("")
      ForEach(Self.options(options, current: selection.wrappedValue), id: \.self) {
        Text($0).tag($0)
      }
    }
  }

  /// The vocabulary, plus a stored value from outside it (an import or an
  /// older edit) so the picker can still show it.
  private static func options(_ vocabulary: [String], current: String) -> [String] {
    current.isEmpty || vocabulary.contains(current) ? vocabulary : vocabulary + [current]
  }

  /// The sparkles button: find the Criterion spine number on criterion.com.
  private func lookUpSpine() {
    let title = values.title.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !title.isEmpty, !spineLookupPending else { return }
    let year = values.year.isEmpty ? nil : Int(values.year.trimmingCharacters(in: .whitespaces))
    spineLookupPending = true
    Task {
      defer { spineLookupPending = false }
      do {
        switch try await library.api.lookupSpine(title: title, year: year) {
        case .failure(let message):
          toasts.error(message)
        case .success(let lookup):
          if let spine = lookup.spine {
            values.spineNumber = String(spine)
            toasts.success("Spine #\(spine)")
          } else {
            toasts.info("No Criterion spine found for “\(title)” — is it in the Collection?")
          }
        }
      } catch {
        toasts.filmFailure(error, fallback: "Spine lookup failed", showServerMessage: false)
      }
    }
  }
}

/// One labelled text field: the label on the left, the value trailing.
private struct FilmFormTextRow: View {
  let label: String
  @Binding var text: String
  var prompt: String?
  var keyboard: UIKeyboardType
  var capitalization: TextInputAutocapitalization
  /// Links and codes: no capitals, no autocorrect.
  var plain: Bool
  var focus: FocusState<FilmFormFocus?>.Binding
  var field: FilmFormFocus

  init(
    _ label: String, text: Binding<String>, prompt: String? = nil,
    keyboard: UIKeyboardType = .default,
    capitalization: TextInputAutocapitalization = .sentences, plain: Bool = false,
    focus: FocusState<FilmFormFocus?>.Binding, field: FilmFormFocus
  ) {
    self.label = label
    self._text = text
    self.prompt = prompt
    self.keyboard = keyboard
    self.capitalization = capitalization
    self.plain = plain
    self.focus = focus
    self.field = field
  }

  var body: some View {
    LabeledContent {
      // No placeholder unless there's a hint to give: the label already
      // names the field.
      TextField(label, text: $text, prompt: Text(prompt ?? ""))
        .multilineTextAlignment(.trailing)
        .keyboardType(keyboard)
        .textInputAutocapitalization(plain || keyboard != .default ? .never : capitalization)
        .autocorrectionDisabled(plain || keyboard != .default)
        .focused(focus, equals: field)
    } label: {
      Text(label)
    }
  }
}

/// The form's submit button, pinned under the content so it stays in reach
/// above the keyboard.
struct FilmFormSubmitBar: View {
  let label: String
  let pending: Bool
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      HStack(spacing: 8) {
        if pending {
          ProgressView().tint(.onAccent)
        }
        Text(label)
      }
      .font(.headline)
      .foregroundStyle(.onAccent)
      .frame(maxWidth: .infinity)
      .padding(.vertical, 6)
    }
    .buttonStyle(.glassProminent)
    .tint(.lbGreen)
    .disabled(pending)
    .frame(maxWidth: 560)
    .padding(.horizontal, 20)
    .padding(.bottom, 8)
  }
}

extension View {
  /// Shared chrome for a film form: the app background, interactive keyboard
  /// dismissal, and a Done key above number pads (which have no return key).
  func filmFormChrome(focus: FocusState<FilmFormFocus?>.Binding) -> some View {
    self
      .spineScreenBackground()
      .scrollDismissesKeyboard(.interactively)
      .toolbar {
        ToolbarItemGroup(placement: .keyboard) {
          Spacer()
          Button("Done") { focus.wrappedValue = nil }
            .fontWeight(.semibold)
        }
      }
  }
}
