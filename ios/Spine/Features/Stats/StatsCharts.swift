import Charts
import SwiftUI

// MARK: - Bar chart

/// A single-series column chart — titles by decade, disc region, age
/// rating. Touch a column to read its value in the header.
struct StatsBarChartCard: View {
  let title: String
  let rows: [StatsCount]
  let color: Color
  /// What the x axis plots, for VoiceOver's audio graph.
  let axisName: String
  var emptyText: String = StatsCopy.empty
  var height: CGFloat = 220
  /// Shortens a category for the axis; the readout shows it in full.
  var axisLabel: (String) -> String = { $0 }

  @State private var selection: String?

  private var selected: StatsCount? {
    selection.flatMap { name in rows.first { $0.name == name } }
  }

  var body: some View {
    StatsCard(title: title) {
      if let selected {
        Text("\(selected.name) · \(Formatters.count(selected.count, "title"))")
          .font(.caption.weight(.semibold))
          .monospacedDigit()
          .foregroundStyle(color)
          .lineLimit(1)
          .transition(.opacity)
      }
    } content: {
      if rows.isEmpty {
        StatsEmptyNote(emptyText)
      } else {
        chart
      }
    }
    .animation(.easeOut(duration: 0.15), value: selection)
  }

  private var chart: some View {
    let ticks = statsIntegerTicks(max: rows.map(\.count).max() ?? 0)
    return Chart(rows) { row in
      BarMark(
        x: .value(axisName, row.name),
        y: .value("Titles", row.count),
        width: .ratio(0.7)
      )
      .clipShape(UnevenRoundedRectangle(topLeadingRadius: 4, topTrailingRadius: 4))
      .foregroundStyle(color.opacity(selection == nil || selection == row.name ? 1 : 0.3))
      .accessibilityLabel(row.name)
      .accessibilityValue(Formatters.count(row.count, "title"))
    }
    .chartXSelection(value: $selection)
    .chartYScale(domain: 0...(ticks.last ?? 1))
    .chartYAxis {
      AxisMarks(position: .leading, values: ticks) { _ in
        AxisGridLine(stroke: StrokeStyle(lineWidth: 1))
          .foregroundStyle(.spineBorder)
        AxisValueLabel()
          .font(.caption2.monospacedDigit())
          .foregroundStyle(.spineMutedForeground)
      }
    }
    .chartXAxis {
      AxisMarks { value in
        // Crowded axes (many decades, big type) drop labels rather than
        // overlap or truncate them; the readout names every column.
        AxisValueLabel(collisionResolution: .greedy) {
          if let name = value.as(String.self) {
            Text(axisLabel(name))
          }
        }
        .font(.caption2)
        .foregroundStyle(.spineMutedForeground)
      }
    }
    .sensoryFeedback(.selection, trigger: selection) { _, new in new != nil }
    // Axis labels past this size no longer fit under the columns.
    .dynamicTypeSize(...DynamicTypeSize.xxLarge)
    .frame(height: height)
  }
}

/// Whole-number y-axis ticks from zero to at least `max`, about four steps
/// (the web's `allowDecimals={false}`).
func statsIntegerTicks(max: Int, desired: Int = 4) -> [Int] {
  guard max > 0 else { return [0, 1] }
  let raw = Double(max) / Double(desired)
  let magnitude = pow(10, (log10(raw)).rounded(.down))
  let nice = [1.0, 2, 5, 10].map { $0 * magnitude }.first { $0 >= raw } ?? 10 * magnitude
  let step = Swift.max(1, Int(nice.rounded(.up)))
  let top = Int((Double(max) / Double(step)).rounded(.up)) * step
  return Array(stride(from: 0, through: top, by: step))
}

// MARK: - Donut

/// A donut with a legend — media type, resolution. Touch a slice (or a
/// legend row) to read it in the middle.
struct StatsDonutCard: View {
  let title: String
  let rows: [StatsCount]

  @State private var selectedAngle: Int?
  @State private var pinned: String?
  @Environment(\.dynamicTypeSize) private var typeSize

  private var total: Int { rows.reduce(0) { $0 + $1.count } }

  /// The slice under the finger, else the legend row tapped.
  private var selected: StatsCount? {
    if let angle = selectedAngle {
      var running = 0
      for row in rows {
        running += row.count
        if angle < running { return row }
      }
      return rows.last
    }
    return pinned.flatMap { name in rows.first { $0.name == name } }
  }

  var body: some View {
    StatsCard(title: title) {
      if rows.isEmpty {
        StatsEmptyNote(StatsCopy.empty)
      } else {
        if typeSize.isAccessibilitySize {
          VStack(spacing: 16) {
            donut.frame(width: 170, height: 170)
            legend
          }
        } else {
          HStack(alignment: .center, spacing: 18) {
            donut.frame(width: 136, height: 136)
            legend.frame(maxWidth: .infinity)
          }
        }
      }
    }
    .animation(.easeOut(duration: 0.15), value: selected?.name)
  }

  private var donut: some View {
    let selectedName = selected?.name
    return Chart(Array(rows.enumerated()), id: \.element.name) { index, row in
      SectorMark(
        angle: .value("Titles", row.count),
        innerRadius: .ratio(0.62),
        angularInset: 1.5
      )
      .cornerRadius(3)
      .foregroundStyle(Color.statsAccent(index))
      .opacity(selectedName == nil || selectedName == row.name ? 1 : 0.35)
      .accessibilityLabel(row.name)
      .accessibilityValue("\(Formatters.count(row.count, "title")), \(percent(row))%")
    }
    .chartAngleSelection(value: $selectedAngle)
    .chartLegend(.hidden)
    .chartBackground { proxy in
      GeometryReader { geometry in
        if let anchor = proxy.plotFrame {
          let frame = geometry[anchor]
          center
            .frame(width: frame.width * 0.56)
            .position(x: frame.midX, y: frame.midY)
        }
      }
    }
    .sensoryFeedback(.selection, trigger: selectedName) { _, new in new != nil }
  }

  private var center: some View {
    VStack(spacing: 1) {
      Text("\(selected?.count ?? total)")
        .font(.title2.weight(.bold))
        .monospacedDigit()
        .foregroundStyle(.spineForeground)
        .contentTransition(.numericText())
      Text(selected?.name ?? "titles")
        .font(.caption2.weight(.medium))
        .foregroundStyle(.spineMutedForeground)
        .lineLimit(1)
        .minimumScaleFactor(0.7)
    }
    .accessibilityHidden(true)
  }

  private var legend: some View {
    VStack(alignment: .leading, spacing: 4) {
      ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
        let isSelected = selected?.name == row.name
        Button {
          pinned = pinned == row.name ? nil : row.name
        } label: {
          HStack(spacing: 8) {
            Circle()
              .fill(Color.statsAccent(index))
              .frame(width: 9, height: 9)
            Text(row.name)
              .font(.subheadline)
              .foregroundStyle(.spineForeground)
              .lineLimit(1)
            Spacer(minLength: 8)
            Text("\(row.count)")
              .font(.subheadline.weight(.semibold))
              .monospacedDigit()
              .foregroundStyle(.spineForeground)
            Text("\(percent(row))%")
              .font(.caption)
              .monospacedDigit()
              .foregroundStyle(.spineMutedForeground)
              .frame(minWidth: 34, alignment: .trailing)
          }
          .padding(.vertical, 5)
          .padding(.horizontal, 8)
          .background(
            isSelected ? Color.spineSecondary : .clear, in: .rect(cornerRadius: 8))
          .contentShape(.rect)
        }
        .buttonStyle(StatsPressStyle())
        .opacity(selected == nil || isSelected ? 1 : 0.55)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(row.name)
        .accessibilityValue("\(Formatters.count(row.count, "title")), \(percent(row))%")
        .accessibilityAddTraits(isSelected ? .isSelected : [])
      }
    }
    .padding(.horizontal, -8)
  }

  private func percent(_ row: StatsCount) -> Int {
    total > 0 ? statsJSRound(Double(row.count) / Double(total) * 100) : 0
  }
}
