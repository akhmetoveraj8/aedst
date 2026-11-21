import SwiftUI

// iOS, macOS and visionOS only: tvOS and watchOS are scaffolded package platforms without app targets.
#if os(iOS) || os(macOS) || os(visionOS)

/// One level of an `AedstBreadcrumb` trail.
public struct AedstBreadcrumbItem: Identifiable, Hashable, Sendable {
    public let id: String
    /// Already localized title of the level.
    public let title: String

    public init(id: String, title: String) {
        self.id = id
        self.title = title
    }
}

/// Path to the current location matching shadcn/ui `Breadcrumb`. The last item is the current page (not a
/// link); when the trail is longer than `maxVisible`, the middle levels collapse into a "More" menu (shadcn
/// `BreadcrumbEllipsis`). The separator is `chevron.forward`, which mirrors in right-to-left layouts.
public struct AedstBreadcrumb: View {
    private let items: [AedstBreadcrumbItem]
    private let maxVisible: Int
    private let onSelect: (AedstBreadcrumbItem) -> Void

    /// - Parameters:
    ///   - items: Levels from the root to the current page.
    ///   - maxVisible: How many levels stay visible before the middle ones collapse (at least 2).
    ///   - onSelect: Called with the level the user picked (never with the current page).
    public init(
        items: [AedstBreadcrumbItem],
        maxVisible: Int = 4,
        onSelect: @escaping (AedstBreadcrumbItem) -> Void
    ) {
        self.items = items
        self.maxVisible = maxVisible
        self.onSelect = onSelect
    }

    public var body: some View {
        let collapsed = Self.collapsedRange(count: items.count, maxVisible: maxVisible)
        ScrollView(.horizontal) {
            HStack(spacing: AedstSpacing.xs) {
                ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                    if let collapsed, collapsed.contains(index) {
                        // The whole collapsed run is drawn once, in place of its first level.
                        if index == collapsed.lowerBound {
                            moreMenu(Array(items[collapsed]))
                            separator
                        }
                    } else if index == items.count - 1 {
                        Text(item.title)
                            .font(AedstTypography.caption.weight(.medium))
                            .foregroundStyle(AedstColor.foreground)
                            .accessibilityAddTraits(.isSelected)
                    } else {
                        link(item)
                        separator
                    }
                }
            }
        }
        .scrollIndicators(.hidden)
        .scrollBounceBehavior(.basedOnSize, axes: .horizontal)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(AedstStrings.breadcrumb))
    }

    private var separator: some View {
        Image(systemName: "chevron.forward")
            .font(AedstTypography.caption)
            .foregroundStyle(AedstColor.mutedForeground)
            .accessibilityHidden(true)
    }

    private func link(_ item: AedstBreadcrumbItem) -> some View {
        Button {
            onSelect(item)
        } label: {
            Text(item.title)
                .font(AedstTypography.caption)
                .foregroundStyle(AedstColor.mutedForeground)
                .aedstHitTarget()
        }
        .buttonStyle(.plain)
    }

    private func moreMenu(_ hidden: [AedstBreadcrumbItem]) -> some View {
        Menu {
            ForEach(hidden) { item in
                Button(item.title) { onSelect(item) }
            }
        } label: {
            Image(systemName: "ellipsis")
                .font(AedstTypography.caption)
                .foregroundStyle(AedstColor.mutedForeground)
                .aedstHitTarget()
        }
        .buttonStyle(.plain)
        #if os(macOS)
        .menuIndicator(.hidden)
        .fixedSize()
        #endif
        .accessibilityLabel(Text(AedstStrings.more))
    }

    /// Indices of the levels hidden behind the "More" menu: everything between the root and the last
    /// `maxVisible - 1` levels, or `nil` when the whole trail fits.
    static func collapsedRange(count: Int, maxVisible: Int) -> Range<Int>? {
        let visible = max(maxVisible, 2)
        guard count > visible else { return nil }
        return 1..<(count - (visible - 1))
    }
}

#Preview("AedstBreadcrumb") {
    let trail = ["Home", "Projects", "Apollo", "Tasks", "Launch checklist"].map { AedstBreadcrumbItem(id: $0, title: $0) }
    return VStack(alignment: .leading, spacing: AedstSpacing.lg) {
        AedstBreadcrumb(items: Array(trail.prefix(3))) { _ in }
        AedstBreadcrumb(items: trail, maxVisible: 3) { _ in }
    }
    .padding()
}

#endif
