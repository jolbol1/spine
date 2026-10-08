import SwiftUI

/// Edit a film's details — the web's edit dialog on the film page.
struct FilmEditSheet: View {
  let film: Film

  @Environment(Library.self) private var library
  @Environment(Toasts.self) private var toasts
  @Environment(Router.self) private var router
  @Environment(\.dismiss) private var dismiss
  @State private var values: FilmFormValues
  @State private var saving = false
  @FocusState private var focus: FilmFormFocus?

  init(film: Film) {
    self.film = film
    _values = State(initialValue: FilmFormValues(film: film))
  }

  var body: some View {
    NavigationStack {
      Form {
        FilmFormSections(
          values: $values, focus: $focus,
          // Other copies — never the film being edited.
          duplicates: CollectionMatch.duplicates(
            in: library.films, of: values.duplicateCandidate, excluding: film.id),
          onOpenDuplicate: { other in
            dismiss()
            router.open(.film(id: other.id))
          })
      }
      .filmFormChrome()
      .navigationTitle("Edit “\(film.title)”")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel", role: .cancel) { dismiss() }
        }
      }
      .safeAreaBar(edge: .bottom) {
        FilmFormSubmitBar(label: "Save changes", pending: saving, focus: $focus, action: save)
      }
    }
    // Unsaved edits aren't lost to a stray swipe; Cancel still discards.
    .interactiveDismissDisabled(saving || values != FilmFormValues(film: film))
  }

  private func save() {
    guard values.hasTitle else {
      toasts.error("A title is required")
      focus = .title
      return
    }
    focus = nil
    saving = true
    Task {
      defer { saving = false }
      do {
        try await library.updateFilm(id: film.id, values.input)
        toasts.success("Film updated")
        dismiss()
      } catch {
        // A manual TMDB id that matches nothing comes back as the server's
        // own message ("TMDB has no movie title with id …").
        toasts.filmFailure(error, fallback: "Could not save changes")
      }
    }
  }
}
