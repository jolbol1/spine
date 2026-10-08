import SwiftUI

/// Screens pushed inside the builder sheet.
private enum ShelfBuilderRoute: Hashable {
  case rule(Int)
  case pinned
  case excluded
}

/// Create or edit one shelf: name, rules, order, grouping, capacity, and
/// pinned / removed films, with a live preview of what it would hold.
struct ShelfBuilderView: View {
  /// nil creates a new shelf, appended last.
  let editing: Shelf?

  @Environment(ShelvesStore.self) private var store
  @Environment(Library.self) private var library
  @Environment(\.dismiss) private var dismiss

  @State private var fields: Fields
  @State private var path: [ShelfBuilderRoute] = []
  @State private var confirmingDelete = false
  private let initialFields: Fields

  /// Everything the form edits — compared to the initial copy to guard
  /// against swiping away unsaved changes.
  fileprivate struct Fields: Equatable {
    var name: String
    var rules: [ShelfRule]
    var sort: [ShelfSortLevel]
    var groupBy: ShelfGroupBy?
    var capacity: String
    var pinned: [String]
    var excluded: [String]
  }

  init(editing: Shelf?) {
    self.editing = editing
    let fields = Fields(
      name: editing?.name ?? "",
      rules: editing?.rules ?? [ShelfRule(field: .format, values: [])],
      sort: editing?.sort ?? [],
      groupBy: editing?.groupBy,
      capacity: editing?.capacity.map(String.init) ?? "",
      pinned: editing?.pinned ?? [],
      excluded: editing?.excluded ?? [])
    initialFields = fields
    _fields = State(initialValue: fields)
  }

  private var trimmedName: String { fields.name.trimmingCharacters(in: .whitespacesAndNewlines) }

  /// The server takes 1–10,000 slots; anything else means no capacity.
  private var capacityValue: Int? {
    guard let value = Int(fields.capacity), value > 0 else { return nil }
    return min(value, 10_000)
  }

  /// The draft as a Shelf, in its final position in the layout.
  private var draft: Shelf {
    Shelf(
      id: editing?.id ?? "draft",
      name: trimmedName.isEmpty ? "New shelf" : trimmedName,
      rules: fields.rules.filter { !$0.values.isEmpty },
      sort: fields.sort.isEmpty ? nil : fields.sort,
      groupBy: fields.groupBy,
      capacity: capacityValue,
      pinned: fields.pinned.isEmpty ? nil : fields.pinned,
      excluded: fields.excluded.isEmpty ? nil : fields.excluded,
      manualOrder: editing?.manualOrder,
      arrangedAt: editing?.arrangedAt)
  }

  var body: some View {
    NavigationStack(path: $path) {
      Form {
        nameSection
        rulesSection
        previewSection
        orderSection
        layoutSection
        overridesSection
        if editing != nil {
          Section {
            Button("Delete Shelf", role: .destructive) { confirmingDelete = true }
              .frame(maxWidth: .infinity)
          }
          .listRowBackground(Color.spineCard)
        }
      }
      .spineScreenBackground()
      .navigationTitle(editing == nil ? "New Shelf" : "Edit Shelf")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel", role: .cancel) { dismiss() }
        }
        ToolbarItem(placement: .confirmationAction) {
          Button(editing == nil ? "Add" : "Save", role: .confirm, action: save)
            .disabled(trimmedName.isEmpty)
        }
      }
      .navigationDestination(for: ShelfBuilderRoute.self) { route in
        destination(route)
      }
      .confirmationDialog(
        "Delete “\(editing?.name ?? "")”?", isPresented: $confirmingDelete,
        titleVisibility: .visible
      ) {
        Button("Delete Shelf", role: .destructive) {
          if let editing { store.delete(id: editing.id) }
          dismiss()
        }
      } message: {
        Text("Its films move to the next shelf they match.")
      }
    }
    .interactiveDismissDisabled(fields != initialFields)
  }

  // MARK: Sections

  private var nameSection: some View {
    Section("Name") {
      TextField("e.g. Boutique editions, 4K wall, TV box sets…", text: $fields.name)
        .textInputAutocapitalization(.words)
        .submitLabel(.done)
        .onSubmit(save)
        .onChange(of: fields.name) { _, name in
          if name.count > 60 { fields.name = String(name.prefix(60)) }
        }
    }
    .listRowBackground(Color.spineCard)
  }

  private var rulesSection: some View {
    Section {
      ForEach(fields.rules.indices, id: \.self) { index in
        let rule = fields.rules[index]
        NavigationLink(value: ShelfBuilderRoute.rule(index)) {
          LabeledContent(ShelfEngine.label(for: rule.field)) {
            Text(valuesSummary(rule.values))
              .lineLimit(1)
          }
        }
      }
      .onDelete { fields.rules.remove(atOffsets: $0) }
      if fields.rules.count < 10 {
        Button("Add Rule", systemImage: "plus") {
          fields.rules.append(ShelfRule(field: .format, values: []))
          path.append(.rule(fields.rules.count - 1))
        }
      }
    } header: {
      Text("Rules — films must match all of them")
    } footer: {
      if fields.rules.isEmpty {
        Text("No rules: this shelf catches every film not already claimed by a shelf above it.")
      }
    }
    .listRowBackground(Color.spineCard)
  }

  private var previewSection: some View {
    let preview = self.preview
    return Section {
      VStack(alignment: .leading, spacing: 6) {
        Text(
          "**\(preview.matching)** title\(preview.matching == 1 ? "" : "s") match these rules — **\(preview.assigned)** would live on this shelf."
        )
        .foregroundStyle(.spineForeground)
        ForEach(preview.claimed, id: \.name) { claim in
          Text("“\(claim.name)” sits higher and claims \(claim.count) of them first.")
            .foregroundStyle(.spineMutedForeground)
        }
      }
      .font(.subheadline)
      .padding(.vertical, 2)
    } header: {
      Text("Preview")
    }
    .listRowBackground(Color.spineCard)
  }

  private var orderSection: some View {
    Section {
      ForEach(fields.sort.indices, id: \.self) { index in
        sortRow(index)
      }
      .onDelete { fields.sort.remove(atOffsets: $0) }
      if fields.sort.count < 3 {
        Button(fields.sort.isEmpty ? "Custom Sort" : "Add Tie-Break", systemImage: "plus") {
          fields.sort.append(ShelfSortLevel(key: .title))
        }
      }
    } header: {
      Text("Order on the shelf")
    } footer: {
      if fields.sort.isEmpty {
        Text("Default: alphabetical by title.")
      }
    }
    .listRowBackground(Color.spineCard)
  }

  private func sortRow(_ index: Int) -> some View {
    let level = fields.sort[index]
    let direction = level.dir ?? ShelfEngine.defaultDirection(for: level.key)
    return HStack(spacing: 12) {
      Picker(
        index == 0 ? "Sort by" : "Then by",
        selection: Binding(
          get: { level.key },
          set: { key in
            guard fields.sort.indices.contains(index) else { return }
            fields.sort[index] = ShelfSortLevel(key: key, dir: nil)
          })
      ) {
        ForEach(ShelfEngine.sortKeys, id: \.key) { option in
          Text(option.label).tag(option.key)
        }
      }
      Button {
        guard fields.sort.indices.contains(index) else { return }
        fields.sort[index].dir = direction == .desc ? .asc : .desc
      } label: {
        Image(systemName: direction == .desc ? "arrow.down" : "arrow.up")
          .font(.subheadline.weight(.semibold))
          .frame(width: 18, height: 18)
      }
      .buttonStyle(.bordered)
      .buttonBorderShape(.circle)
      .accessibilityLabel("Flip direction")
      .accessibilityValue(direction == .desc ? "Descending" : "Ascending")
    }
  }

  private var layoutSection: some View {
    Section {
      Picker("Group within shelf", selection: $fields.groupBy) {
        ForEach(ShelfEngine.groupByOptions, id: \.label) { option in
          Text(option.label).tag(option.value)
        }
      }
      LabeledContent("Capacity") {
        TextField("Physical slots", text: $fields.capacity)
          .keyboardType(.numberPad)
          .multilineTextAlignment(.trailing)
          .onChange(of: fields.capacity) { _, text in
            let digits = String(text.filter { $0.isASCII && $0.isNumber }.prefix(5))
            if digits != text { fields.capacity = digits }
          }
      }
    } footer: {
      Text("Capacity is optional — films past it are flagged as the spill for the next shelf.")
    }
    .listRowBackground(Color.spineCard)
  }

  private var overridesSection: some View {
    Section {
      NavigationLink(value: ShelfBuilderRoute.pinned) {
        LabeledContent("Pinned here", value: fields.pinned.isEmpty ? "None" : "\(fields.pinned.count)")
      }
      NavigationLink(value: ShelfBuilderRoute.excluded) {
        LabeledContent(
          "Removed from this shelf",
          value: fields.excluded.isEmpty ? "None" : "\(fields.excluded.count)")
      }
    } header: {
      Text("Overrides")
    } footer: {
      Text(
        "Pinned films stay on this shelf whatever the rules say. Removed films skip it and land on the next shelf they match."
      )
    }
    .listRowBackground(Color.spineCard)
  }

  // MARK: Pushed screens

  @ViewBuilder private func destination(_ route: ShelfBuilderRoute) -> some View {
    switch route {
    case .rule(let index):
      ShelfRuleEditor(
        rule: Binding(
          get: {
            fields.rules.indices.contains(index)
              ? fields.rules[index] : ShelfRule(field: .format, values: [])
          },
          set: { rule in
            if fields.rules.indices.contains(index) { fields.rules[index] = rule }
          }),
        films: library.films)
    case .pinned:
      let homes = homeNames()
      ShelfFilmPicker(
        title: "Pinned Here",
        footer: "Pinned films stay on this shelf whatever the rules say.",
        films: library.films,
        isSelected: { fields.pinned.contains($0.id) },
        detail: { homes[$0.id] ?? "Unshelved" },
        toggle: { film in
          if let index = fields.pinned.firstIndex(of: film.id) {
            fields.pinned.remove(at: index)
          } else {
            fields.pinned.append(film.id)
            fields.excluded.removeAll { $0 == film.id }
          }
        })
    case .excluded:
      ShelfFilmPicker(
        title: "Removed from Shelf",
        footer:
          "Films these rules match. Removed films skip this shelf and land on the next one they match.",
        films: library.films.filter {
          ShelfEngine.matchesRules($0, draft) || fields.excluded.contains($0.id)
        },
        isSelected: { fields.excluded.contains($0.id) },
        detail: { fields.pinned.contains($0.id) ? "Pinned here" : nil },
        toggle: { film in
          if let index = fields.excluded.firstIndex(of: film.id) {
            fields.excluded.remove(at: index)
          } else {
            fields.excluded.append(film.id)
            fields.pinned.removeAll { $0 == film.id }
          }
        })
    }
  }

  // MARK: Preview

  private struct Preview {
    var matching: Int
    var assigned: Int
    var claimed: [(name: String, count: Int)]
  }

  /// What the draft's rules match, and how much of that a higher shelf
  /// claims first — precedence made tangible before saving.
  private var preview: Preview {
    let draft = self.draft
    let shelves = store.shelves
    let layout =
      editing != nil ? shelves.map { $0.id == draft.id ? draft : $0 } : shelves + [draft]
    let draftIndex = layout.firstIndex { $0.id == draft.id } ?? layout.count
    let films = library.films
    let assignment = ShelfEngine.assign(films, to: layout)
    var claimed: [(name: String, count: Int)] = []
    for shelf in layout.prefix(draftIndex) {
      let count = assignment.films(on: shelf).count { ShelfEngine.matchesRules($0, draft) }
      guard count > 0 else { continue }
      if let existing = claimed.firstIndex(where: { $0.name == shelf.name }) {
        claimed[existing].count = count
      } else {
        claimed.append((shelf.name, count))
      }
    }
    return Preview(
      matching: films.count { ShelfEngine.matchesRules($0, draft) },
      assigned: assignment.byShelf[draft.id]?.count ?? 0,
      claimed: claimed)
  }

  // MARK: Helpers

  private func valuesSummary(_ values: [String]) -> String {
    if values.isEmpty { return "Any value" }
    if values.count <= 2 { return values.joined(separator: ", ") }
    return "\(values.count) selected"
  }

  /// Where each film sits in the saved layout, for the pin picker.
  private func homeNames() -> [String: String] {
    let assignment = ShelfEngine.assign(library.films, to: store.shelves)
    var names: [String: String] = [:]
    for shelf in store.shelves {
      let name = shelf.id == editing?.id ? "On this shelf" : "On “\(shelf.name)”"
      for film in assignment.films(on: shelf) { names[film.id] = name }
    }
    return names
  }

  private func save() {
    guard !trimmedName.isEmpty else { return }
    var shelf = draft
    shelf.id = editing?.id ?? UUID().uuidString.lowercased()
    shelf.name = trimmedName
    store.save(shelf)
    dismiss()
  }
}

/// One rule: the field it tests and the values (from the collection, with
/// counts) that satisfy it.
private struct ShelfRuleEditor: View {
  @Binding var rule: ShelfRule
  let films: [Film]

  var body: some View {
    let options = ShelfEngine.fieldOptions(films, rule.field)
    // Values picked before the last film carrying them left the collection
    // stay listed, so they can still be unticked.
    let missing = rule.values.filter { value in !options.contains { $0.value == value } }
    let rows = options + missing.map { (value: $0, count: 0) }

    Form {
      Section {
        Picker(
          "Field",
          selection: Binding(
            get: { rule.field },
            set: { rule = ShelfRule(field: $0, values: []) })
        ) {
          ForEach(ShelfEngine.ruleFields, id: \.field) { option in
            Text(option.label).tag(option.field)
          }
        }
      }
      .listRowBackground(Color.spineCard)

      Section {
        if rows.isEmpty {
          Text("Nothing in your collection has this field.")
            .foregroundStyle(.spineMutedForeground)
        }
        ForEach(rows, id: \.value) { option in
          let selected = rule.values.contains(option.value)
          Button {
            if selected {
              rule.values.removeAll { $0 == option.value }
            } else {
              rule.values.append(option.value)
            }
          } label: {
            HStack {
              Text(option.value)
                .foregroundStyle(.spineForeground)
              Spacer()
              Text("\(option.count)")
                .font(.subheadline.monospacedDigit())
                .foregroundStyle(.spineMutedForeground)
              Image(systemName: "checkmark")
                .font(.body.weight(.semibold))
                .foregroundStyle(.lbGreen)
                .opacity(selected ? 1 : 0)
                .accessibilityHidden(true)
            }
            .contentShape(.rect)
          }
          .accessibilityAddTraits(selected ? .isSelected : [])
          .accessibilityValue(Formatters.count(option.count, "film"))
        }
      } header: {
        Text("Values")
      } footer: {
        Text(
          rule.values.isEmpty
            ? "Any value — tick one or more to narrow the shelf."
            : "A film matches when it has any of the ticked values.")
      }
      .listRowBackground(Color.spineCard)
    }
    .spineScreenBackground()
    .navigationTitle(ShelfEngine.label(for: rule.field))
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      if !rule.values.isEmpty {
        ToolbarItem(placement: .topBarTrailing) {
          Button("Clear") { rule.values = [] }
        }
      }
    }
  }
}

/// A searchable, tickable list of films — for pins and removals.
private struct ShelfFilmPicker: View {
  let title: String
  let footer: String
  let films: [Film]
  let isSelected: (Film) -> Bool
  let detail: (Film) -> String?
  let toggle: (Film) -> Void

  @State private var query = ""

  private var filtered: [Film] {
    let trimmed = query.trimmingCharacters(in: .whitespaces)
    guard !trimmed.isEmpty else { return films }
    return films.filter { $0.title.localizedStandardContains(trimmed) }
  }

  var body: some View {
    List {
      Section {
        ForEach(filtered) { film in
          let selected = isSelected(film)
          Button {
            toggle(film)
          } label: {
            HStack(spacing: 12) {
              PosterFrame(url: film.coverURL, title: "", cornerRadius: 3, maxPixelSize: 120)
                .frame(width: 32)
              VStack(alignment: .leading, spacing: 2) {
                Text(film.title)
                  .font(.body)
                  .foregroundStyle(.spineForeground)
                  .lineLimit(1)
                HStack(spacing: 6) {
                  if let year = film.year {
                    Text(String(year))
                  }
                  FormatBadge(format: film.format)
                  if let detail = detail(film) {
                    Text(detail).lineLimit(1)
                  }
                }
                .font(.caption)
                .foregroundStyle(.spineMutedForeground)
              }
              Spacer(minLength: 8)
              Image(systemName: "checkmark")
                .font(.body.weight(.semibold))
                .foregroundStyle(.lbGreen)
                .opacity(selected ? 1 : 0)
                .accessibilityHidden(true)
            }
            .contentShape(.rect)
          }
          .accessibilityElement(children: .combine)
          .accessibilityAddTraits(selected ? .isSelected : [])
        }
      } footer: {
        Text(footer)
      }
      .listRowBackground(Color.spineCard)
    }
    .overlay {
      if filtered.isEmpty {
        if query.isEmpty {
          ContentUnavailableView(
            "No films", systemImage: "film",
            description: Text("Nothing in your collection matches these rules yet."))
        } else {
          ContentUnavailableView.search(text: query)
        }
      }
    }
    .spineScreenBackground()
    .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search titles")
    .navigationTitle(title)
    .navigationBarTitleDisplayMode(.inline)
  }
}
