import Charts
import SwiftUI

// iOS, macOS and visionOS only: tvOS and watchOS are scaffolded package platforms without app targets.
#if os(iOS) || os(macOS) || os(visionOS)

/// One value of an `AedstChart`.
public struct AedstChartPoint: Identifiable, Hashable, Sendable {
    public let id: String
    /// Label on the category (x) axis, already localized or formatted (a month, a status).
    public let category: String
    /// The plotted value.
    public let value: Double
    /// Name of the series the point belongs to, already localized; one colour per series.
    public let series: String

    public init(category: String, value: Double, series: String) {
        self.id = "\(series)|\(category)"
        self.category = category
        self.value = value
        self.series = series
    }
}

/// The mark an `AedstChart` draws.
public enum AedstChartKind: Sendable, CaseIterable {
    case bar
    case line
    case area
}

/// Chart matching shadcn/ui `Chart`, built on Swift Charts (a system framework): series colours come from
/// the `chart1`...`chart5` tokens in order, the legend is the framework's own.
///
/// Accessibility: the chart is named by `title`, every mark is labelled "series, category" with its value,
/// and Swift Charts adds Audio Graph support for VoiceOver by itself. An empty chart says "No data".
public struct AedstChart: View {
    private let title: String
    private let points: [AedstChartPoint]
    private let kind: AedstChartKind
    private let categoryLabel: String
    private let valueLabel: String
    private let showsLegend: Bool
    private let height: CGFloat

    /// - Parameters:
    ///   - title: Already localized name of the chart, shown above it and read by VoiceOver.
    ///   - points: The values, in axis order.
    ///   - categoryLabel: Name of the category axis for assistive technologies ("Month").
    ///   - valueLabel: Name of the value axis for assistive technologies ("Tasks").
    ///   - showsLegend: Shows the series legend (hide it for a single series).
    ///   - height: Height of the plot area.
    public init(
        _ title: String,
        points: [AedstChartPoint],
        kind: AedstChartKind = .bar,
        categoryLabel: String,
        valueLabel: String,
        showsLegend: Bool = true,
        height: CGFloat = 220
    ) {
        self.title = title
        self.points = points
        self.kind = kind
        self.categoryLabel = categoryLabel
        self.valueLabel = valueLabel
        self.showsLegend = showsLegend
        self.height = height
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: AedstSpacing.sm) {
            Text(title)
                .font(AedstTypography.headline)
                .foregroundStyle(AedstColor.foreground)
                .accessibilityAddTraits(.isHeader)
            if points.isEmpty {
                Text(AedstStrings.noData)
                    .font(AedstTypography.caption)
                    .foregroundStyle(AedstColor.mutedForeground)
                    .frame(maxWidth: .infinity, minHeight: height)
            } else {
                chart
                    .frame(height: height)
                    .accessibilityLabel(Text(title))
            }
        }
    }

    private var seriesNames: [String] { Self.seriesNames(in: points) }

    private var seriesColors: [Color] {
        let palette = AedstColor.chartSeries
        return seriesNames.indices.map { palette[$0 % palette.count] }
    }

    private var chart: some View {
        Chart(points) { point in
            mark(for: point)
                .foregroundStyle(by: .value(AedstStrings.chart, point.series))
                .accessibilityLabel(Text(verbatim: "\(point.series), \(point.category)"))
                .accessibilityValue(Text(point.value.formatted()))
        }
        .chartForegroundStyleScale(domain: seriesNames, range: seriesColors)
        .chartLegend(showsLegend ? .visible : .hidden)
    }

    @ChartContentBuilder
    private func mark(for point: AedstChartPoint) -> some ChartContent {
        switch kind {
        case .bar:
            BarMark(
                x: .value(categoryLabel, point.category),
                y: .value(valueLabel, point.value)
            )
            .position(by: .value(AedstStrings.chart, point.series))
        case .line:
            LineMark(
                x: .value(categoryLabel, point.category),
                y: .value(valueLabel, point.value)
            )
        case .area:
            AreaMark(
                x: .value(categoryLabel, point.category),
                y: .value(valueLabel, point.value)
            )
        }
    }

    /// Series names in order of first appearance: the order of the colours and of the legend.
    static func seriesNames(in points: [AedstChartPoint]) -> [String] {
        var seen = Set<String>()
        return points.compactMap { seen.insert($0.series).inserted ? $0.series : nil }
    }
}

#Preview("AedstChart") {
    let months = ["Jan", "Feb", "Mar", "Apr"]
    let points = months.enumerated().flatMap { index, month in
        [
            AedstChartPoint(category: month, value: Double(4 + index * 2), series: "Done"),
            AedstChartPoint(category: month, value: Double(6 - index), series: "Open"),
        ]
    }
    return VStack(spacing: AedstSpacing.lg) {
        AedstChart("Tasks per month", points: points, categoryLabel: "Month", valueLabel: "Tasks")
        AedstChart("Trend", points: points, kind: .line, categoryLabel: "Month", valueLabel: "Tasks")
    }
    .padding()
}

#endif
