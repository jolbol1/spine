import SwiftUI

/// Above the films: the media-type switch, the active filters, the A–Z
/// letters (alphabetical sort only), and the metric-sort caption.
struct CollectionBrowseHeader<Controls: View>: View {
  @Binding var query: CollectionQuery
  /// The whole collection — counts and letters come from all of it.
  let films: [Film]
  /// How many films the current state shows.
  let matchCount: Int
  /// Browse controls beside the media-type switch, when they aren't in the
  /// toolbar (iPad).
  var showsControls = false
  @ViewBuilder var controls: () -> Controls

  var body: some View {
    VStack(alignment: .leading, spacing: 14) {
      if showsControls {
        ViewThatFits(in: .horizontal) {
          HStack(spacing: 16) {
            mediaTypePicker
              .frame(maxWidth: 380)
              .layoutPriority(1)
            Spacer(minLength: 0)
            controls()
          }
          VStack(alignment: .leading, spacing: 12) {
            mediaTypePicker
            controls()
          }
        }
      } else {
        mediaTypePicker
      }

      if query.activeFilterCount > 0 {
        CollectionActiveFilters(query: $query, matchCount: matchCount)
      }

      if query.sort == .title {
        CollectionLetterRail(query: $query, present: CollectionQuery.presentLetters(films))
      }

      if let caption = query.metricCaption {
        Text(caption.uppercased())
          .font(.caption2.weight(.medium))
          .tracking(0.6)
          .foregroundStyle(.spineMutedForeground)
          .fixedSize(horizontal: false, vertical: true)
      }
    }
  }

  private var mediaTypePicker: some View {
    let tvCount = films.count(where: \.isTV)
    return Picker(
      "Media type",
      selection: Binding(get: { query.mediaType }, set: { query.setMediaType($0) })
    ) {
      Text("All (\(films.count))").tag(CollectionMediaType.all)
      Text("Movies (\(films.count - tvCount))").tag(CollectionMediaType.movie)
      Text("TV (\(tvCount))").tag(CollectionMediaType.tv)
    }
    .pickerStyle(.segmented)
  }
}

/// "12 titles match · Clear all", then a chip per active filter — tap one
/// to drop it.
private struct CollectionActiveFilters: View {
  @Binding var query: CollectionQuery
  let matchCount: Int

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      HStack(alignment: .firstTextBaseline) {
        Text("\(Formatters.count(matchCount, "title")) match")
          .font(.footnote)
          .monospacedDigit()
          .foregroundStyle(.spineMutedForeground)
        Spacer()
        Button {
          withAnimation(.snappy) { query.clearFilters() }
        } label: {
          Label("Clear all", systemImage: "xmark")
            .font(.footnote.weight(.semibold))
            .padding(.vertical, 6)
            .padding(.leading, 12)
            .contentShape(.rect)
        }
        .tint(.spineForeground)
      }

      ScrollView(.horizontal) {
        GlassEffectContainer(spacing: 6) {
          HStack(spacing: 6) {
            ForEach(CollectionFilter.allCases) { filter in
              let value = query.filterValue(filter)
              if value != CollectionQuery.any {
                Button {
                  withAnimation(.snappy) { query.setFilter(filter, CollectionQuery.any) }
                } label: {
                  HStack(spacing: 5) {
                    Text(filter.title)
                      .foregroundStyle(.spineMutedForeground)
                    Text(value)
                      .foregroundStyle(.spineForeground)
                    Image(systemName: "xmark")
                      .font(.caption2.weight(.bold))
                      .foregroundStyle(.spineMutedForeground)
                  }
                  .font(.footnote.weight(.medium))
                  .padding(.horizontal, 11)
                  .padding(.vertical, 6)
                  .glassEffect(.regular.interactive(), in: .capsule)
                  .contentShape(.capsule)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Remove filter \(filter.title): \(value)")
              }
            }
          }
          .padding(.vertical, 2)
        }
      }
      .scrollIndicators(.hidden)
      .scrollClipDisabled()
    }
  }
}

/// The A–Z browse row: ALL, #, A–Z. Letters with no films are disabled;
/// tapping the active letter goes back to ALL.
private struct CollectionLetterRail: View {
  @Binding var query: CollectionQuery
  let present: Set<String>

  var body: some View {
    ScrollViewReader { proxy in
      ScrollView(.horizontal) {
        HStack(spacing: 2) {
          chip("ALL", value: nil, enabled: true)
          ForEach(CollectionQuery.letters, id: \.self) { letter in
            chip(letter, value: letter, enabled: present.contains(letter))
          }
        }
        .padding(4)
      }
      .scrollIndicators(.hidden)
      .glassEffect(.regular, in: .capsule)
      .clipShape(.capsule)
      .onAppear {
        if let letter = query.letter { proxy.scrollTo(letter, anchor: .center) }
      }
    }
    .sensoryFeedback(.selection, trigger: query.letter)
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Browse alphabetically")
  }

  private func chip(_ title: String, value: String?, enabled: Bool) -> some View {
    let selected = query.letter == value
    return Button {
      withAnimation(.snappy) {
        if value == nil {
          query.set("letter", nil)
        } else {
          query.toggleLetter(value)
        }
      }
    } label: {
      Text(title)
        .font(.footnote.weight(.bold).monospacedDigit())
        .foregroundStyle(selected ? Color.onAccent : Color.spineForeground)
        .padding(.horizontal, title.count > 1 ? 10 : 0)
        .frame(minWidth: 30, minHeight: 30)
        .background {
          if selected { Capsule().fill(.lbGreen) }
        }
        .contentShape(.capsule)
    }
    .buttonStyle(.plain)
    .disabled(!enabled)
    .opacity(enabled ? 1 : 0.25)
    .id(value ?? "ALL")
    .accessibilityLabel(value == nil ? "All letters" : title)
    .accessibilityAddTraits(selected ? .isSelected : [])
  }
}
