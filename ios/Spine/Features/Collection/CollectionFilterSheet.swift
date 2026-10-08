import SwiftUI

/// The advanced filters: one picker per filter, each offering only the
/// values present in the collection, with counts. Changes apply live, so the
/// grid behind a half-height sheet updates as you pick.
struct CollectionFilterSheet: View {
  @Binding var query: CollectionQuery
  let films: [Film]

  @Environment(\.dismiss) private var dismiss

  var body: some View {
    let options = CollectionQuery.filterOptions(films)
    let matchCount = query.visible(films).count
    NavigationStack {
      Form {
        Section {
          ForEach(CollectionFilter.allCases) { filter in
            CollectionFilterRow(
              filter: filter,
              selection: Binding(
                get: { query.filterValue(filter) },
                set: { query.setFilter(filter, $0) }),
              options: options[filter] ?? [])
          }
          .listRowBackground(Color.spineCard)
        } footer: {
          if query.activeFilterCount > 0 {
            Text("\(Formatters.count(matchCount, "title")) match")
              .monospacedDigit()
          }
        }
      }
      .spineScreenBackground()
      .navigationTitle("Filters")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Clear all") {
            withAnimation(.snappy) { query.clearFilters() }
          }
          .disabled(query.activeFilterCount == 0)
        }
        ToolbarItem(placement: .confirmationAction) {
          Button("Done", systemImage: "checkmark", role: .confirm) { dismiss() }
        }
      }
    }
    .presentationDetents([.medium, .large])
  }
}

/// "Decade ........ 1970s ⌃⌄" — a menu of All plus each present value with
/// its count. An active filter shows its value in green.
private struct CollectionFilterRow: View {
  let filter: CollectionFilter
  @Binding var selection: String
  let options: [CollectionFilterOption]

  var body: some View {
    let active = selection != CollectionQuery.any
    LabeledContent(filter.title) {
      Menu {
        Picker(filter.title, selection: $selection) {
          Text("All").tag(CollectionQuery.any)
          ForEach(choices, id: \.value) { option in
            Text("\(option.value) (\(option.count))").tag(option.value)
          }
        }
        .pickerStyle(.inline)
      } label: {
        HStack(spacing: 4) {
          Text(active ? selection : "All")
            .lineLimit(1)
          Image(systemName: "chevron.up.chevron.down")
            .font(.caption2.weight(.semibold))
            .imageScale(.small)
        }
        .foregroundStyle(active ? Color.lbGreen : Color.spineMutedForeground)
        .fontWeight(active ? .semibold : .regular)
      }
      .accessibilityLabel(filter.title)
      .accessibilityValue(active ? selection : "All")
    }
    .foregroundStyle(.spineForeground)
  }

  /// The present values — plus the selected one if no film has it any more
  /// (a stale saved view), so the picker can still show and clear it.
  private var choices: [CollectionFilterOption] {
    guard selection != CollectionQuery.any,
      !options.contains(where: { $0.value == selection })
    else { return options }
    return options + [CollectionFilterOption(value: selection, count: 0)]
  }
}
