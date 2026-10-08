import SwiftUI

/// Saved views: tap one to restore it (the active one is checked, the default
/// marked), save the current state, or edit the list. The icon fills while a
/// saved view is in use; its name shows under the large title.
struct CollectionViewsMenu: View {
  let views: [SavedView]
  let activeView: SavedView?
  var onApply: (SavedView) -> Void
  var onSave: () -> Void
  var onManage: () -> Void
  /// In-content (iPad): the label names the active view, as the web's does.
  var titled = false

  var body: some View {
    Menu {
      if !views.isEmpty {
        Section {
          ForEach(views, id: \.name) { view in
            Toggle(
              isOn: Binding(
                get: { view.name == activeView?.name },
                set: { _ in onApply(view) })
            ) {
              Text(view.name)
              if view.isDefault == true { Text("★ Default view") }
            }
          }
        }
      }
      Section {
        Button("Save current view…", action: onSave)
        if !views.isEmpty {
          Button("Edit views…", action: onManage)
        }
      }
    } label: {
      Label(
        titled ? (activeView?.name ?? "Views") : "Views",
        systemImage: activeView == nil ? "bookmark" : "bookmark.fill")
    }
    .accessibilityValue(activeView?.name ?? "")
    .accessibilityIdentifier("collection.views")
  }
}

/// "Save current view": a name and a default toggle, with the web's helper
/// copy. Saving under an existing name overwrites that view.
struct CollectionSaveViewSheet: View {
  let params: [String: String]
  let activeView: SavedView?

  @Environment(Library.self) private var library
  @Environment(Toasts.self) private var toasts
  @Environment(\.dismiss) private var dismiss

  @State private var name: String
  @State private var isDefault: Bool
  @State private var isSaving = false
  @FocusState private var nameFocused: Bool

  init(params: [String: String], activeView: SavedView?) {
    self.params = params
    self.activeView = activeView
    _name = State(initialValue: activeView?.name ?? "")
    _isDefault = State(initialValue: activeView?.isDefault ?? false)
  }

  private var trimmedName: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }

  var body: some View {
    NavigationStack {
      Form {
        Section("Name") {
          TextField("e.g. Criterion steelbooks, unwatched 4K…", text: $name)
            .focused($nameFocused)
            .submitLabel(.done)
            .onSubmit(save)
        }
        .listRowBackground(Color.spineCard)

        Section {
          Toggle(isOn: $isDefault) {
            Text("Set as default view")
            Text("Loaded whenever you open the collection fresh.")
          }
          .tint(.lbGreen)
        } footer: {
          Text(
            "Saves the current search, filters, sort, poster info, and grid/list choice. Reusing a name overwrites that view."
          )
        }
        .listRowBackground(Color.spineCard)
      }
      .spineScreenBackground()
      .navigationTitle("Save current view")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel", role: .cancel) { dismiss() }
        }
        ToolbarItem(placement: .confirmationAction) {
          if isSaving {
            ProgressView()
          } else {
            Button("Save view", role: .confirm, action: save)
              .disabled(trimmedName.isEmpty)
          }
        }
      }
      .onAppear { nameFocused = true }
    }
    .presentationDetents([.medium, .large])
    .interactiveDismissDisabled(isSaving)
  }

  private func save() {
    let name = trimmedName
    guard !name.isEmpty, !isSaving else { return }
    let next = CollectionSavedViews.saving(
      library.settings?.savedViews ?? [], name: name, params: params, isDefault: isDefault)
    isSaving = true
    Task {
      defer { isSaving = false }
      do {
        try await library.saveViews(next)
        toasts.success("View “\(name)” saved")
        dismiss()
      } catch {
        toasts.error("Could not save views")
      }
    }
  }
}

/// Edit the saved views: star the default, rename, delete. Tapping a view
/// restores it.
struct CollectionManageViewsSheet: View {
  let activeName: String?
  var onApply: (SavedView) -> Void

  @Environment(Library.self) private var library
  @Environment(Toasts.self) private var toasts
  @Environment(\.dismiss) private var dismiss

  @State private var renaming: String?
  @State private var renameText = ""

  private var views: [SavedView] { library.settings?.savedViews ?? [] }

  var body: some View {
    NavigationStack {
      List {
        Section {
          ForEach(views, id: \.name) { view in
            row(view)
          }
          .listRowBackground(Color.spineCard)
        } footer: {
          Text("The starred view loads whenever you open the collection fresh.")
        }
      }
      .spineScreenBackground()
      .overlay {
        if views.isEmpty {
          ContentUnavailableView(
            "No saved views", systemImage: "bookmark",
            description: Text("Save the current search, filters, and sort to come back to them."))
        }
      }
      .navigationTitle("Saved views")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .confirmationAction) {
          Button("Done", systemImage: "checkmark", role: .confirm) { dismiss() }
        }
      }
      .alert(
        "Rename view",
        isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })
      ) {
        TextField("Name", text: $renameText)
        Button("Cancel", role: .cancel) { renaming = nil }
        Button("Rename view", action: rename)
          .disabled(renameText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
      } message: {
        Text("Reusing another view's name overwrites that view.")
      }
    }
    .presentationDetents([.medium, .large])
  }

  private func row(_ view: SavedView) -> some View {
    let isDefault = view.isDefault == true
    return HStack(spacing: 12) {
      Button {
        onApply(view)
        dismiss()
      } label: {
        HStack(spacing: 10) {
          VStack(alignment: .leading, spacing: 2) {
            Text(view.name)
              .foregroundStyle(.spineForeground)
            if isDefault {
              Text("Default view")
                .font(.caption)
                .foregroundStyle(.lbOrange)
            }
          }
          Spacer(minLength: 8)
          if view.name == activeName {
            Image(systemName: "checkmark")
              .font(.subheadline.weight(.semibold))
              .foregroundStyle(.lbGreen)
              .accessibilityLabel("Active")
          }
        }
        .contentShape(.rect)
      }
      .buttonStyle(.plain)

      Button {
        save(CollectionSavedViews.togglingDefault(views, name: view.name))
      } label: {
        Image(systemName: isDefault ? "star.fill" : "star")
          .foregroundStyle(isDefault ? Color.lbOrange : Color.spineMutedForeground)
          .frame(width: 32, height: 32)
          .contentShape(.rect)
      }
      .buttonStyle(.borderless)
      .accessibilityLabel(
        isDefault ? "Unset \(view.name) as default view" : "Set \(view.name) as default view")
    }
    .swipeActions(edge: .trailing) {
      Button("Delete", systemImage: "trash", role: .destructive) {
        save(CollectionSavedViews.deleting(views, name: view.name))
      }
      Button("Rename", systemImage: "pencil") { startRename(view.name) }
        .tint(.lbBlue)
    }
    .contextMenu {
      Button("Rename…", systemImage: "pencil") { startRename(view.name) }
      Button(
        isDefault ? "Unset as default" : "Set as default",
        systemImage: isDefault ? "star.slash" : "star"
      ) {
        save(CollectionSavedViews.togglingDefault(views, name: view.name))
      }
      Divider()
      Button("Delete", systemImage: "trash", role: .destructive) {
        save(CollectionSavedViews.deleting(views, name: view.name))
      }
    }
  }

  private func startRename(_ name: String) {
    renameText = name
    renaming = name
  }

  private func rename() {
    guard let from = renaming else { return }
    let to = renameText.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !to.isEmpty else { return }
    renaming = nil
    guard to != from else { return }
    save(CollectionSavedViews.renaming(views, from: from, to: to)) {
      toasts.success("View “\(from)” renamed to “\(to)”")
    }
  }

  private func save(_ next: [SavedView], onSuccess: (() -> Void)? = nil) {
    Task {
      do {
        try await library.saveViews(next)
        onSuccess?()
      } catch {
        toasts.error("Could not save views")
      }
    }
  }
}
