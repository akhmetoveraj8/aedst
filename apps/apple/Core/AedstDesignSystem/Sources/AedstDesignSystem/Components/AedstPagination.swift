import SwiftUI

// iOS, macOS and visionOS only: tvOS and watchOS are scaffolded package platforms without app targets.
#if os(iOS) || os(macOS) || os(visionOS)

/// One slot of the page list: a page link or a gap.
public enum AedstPaginationItem: Hashable, Sendable {
    /// A link to the 1-based page.
    case page(Int)
    /// A gap; the associated value is the page after which it stands (keeps the two gaps distinct).
    case ellipsis(after: Int)
}

/// Page navigation matching shadcn/ui `Pagination`: previous, a window of page links with gaps, next. When the
/// full list does not fit (a narrow iPhone, large Dynamic Type), it falls back to "Page 3 of 10" between the
/// two arrows. The arrows are `chevron.backward` / `chevron.forward`, which mirror in right-to-left layouts.
public struct AedstPagination: View {
    @Binding private var page: Int
    private let pageCount: Int
    private let siblingCount: Int

    /// - Parameters:
    ///   - page: The current 1-based page.
    ///   - pageCount: Total number of pages; nothing is drawn for fewer than two.
    ///   - siblingCount: Page links kept on each side of the current page.
    public init(page: Binding<Int>, pageCount: Int, siblingCount: Int = 1) {
        self._page = page
        self.pageCount = pageCount
        self.siblingCount = siblingCount
    }

    public var body: some View {
        if pageCount > 1 {
            ViewThatFits(in: .horizontal) {
                full
                compact
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel(Text(AedstStrings.pagination))
        }
    }

    private var current: Int { min(max(page, 1), pageCount) }

    private var full: some View {
        HStack(spacing: AedstSpacing.xs) {
            previousButton
            ForEach(Self.items(page: current, pageCount: pageCount, siblingCount: siblingCount), id: \.self) { item in
                switch item {
                case .page(let number):
                    AedstButton(
                        number.formatted(),
                        variant: number == current ? .outline : .ghost,
                        size: .sm,
                        fillsWidth: false
                    ) {
                        page = number
                    }
                    .accessibilityLabel(Text(AedstStrings.page(number.formatted())))
                    .accessibilityAddTraits(number == current ? .isSelected : [])
                case .ellipsis:
                    Image(systemName: "ellipsis")
                        .font(AedstTypography.caption)
                        .foregroundStyle(AedstColor.mutedForeground)
                        .padding(.horizontal, AedstSpacing.xs)
                        .accessibilityLabel(Text(AedstStrings.morePages))
                }
            }
            nextButton
        }
    }

    private var compact: some View {
        HStack(spacing: AedstSpacing.sm) {
            previousButton
            Text(AedstStrings.pageOf(current.formatted(), pageCount.formatted()))
                .font(AedstTypography.caption)
                .foregroundStyle(AedstColor.mutedForeground)
            nextButton
        }
    }

    private var previousButton: some View {
        AedstIconButton(
            systemImage: "chevron.backward",
            accessibilityLabel: AedstStrings.previous,
            size: .iconSm,
            isDisabled: current <= 1
        ) {
            page = current - 1
        }
    }

    private var nextButton: some View {
        AedstIconButton(
            systemImage: "chevron.forward",
            accessibilityLabel: AedstStrings.next,
            size: .iconSm,
            isDisabled: current >= pageCount
        ) {
            page = current + 1
        }
    }

    /// The page window: always the first and the last page, `siblingCount` pages around the current one, and
    /// a gap wherever more than one page is skipped. The list has a constant length (`2 * siblingCount + 5`)
    /// once there are more pages than that, so the control does not jump while paging.
    static func items(page: Int, pageCount: Int, siblingCount: Int) -> [AedstPaginationItem] {
        guard pageCount > 0 else { return [] }
        let siblings = max(siblingCount, 0)
        let current = min(max(page, 1), pageCount)
        let slots = 2 * siblings + 5
        guard pageCount > slots else {
            return (1...pageCount).map { AedstPaginationItem.page($0) }
        }

        let left = max(current - siblings, 1)
        let right = min(current + siblings, pageCount)
        let hasLeftGap = left > 2
        let hasRightGap = right < pageCount - 1
        let edgeCount = 2 * siblings + 3

        // Built with appends (not one `+` chain) so the type checker has nothing to search.
        var result: [AedstPaginationItem] = []
        if !hasLeftGap {
            result.append(contentsOf: (1...edgeCount).map { AedstPaginationItem.page($0) })
            result.append(.ellipsis(after: edgeCount))
            result.append(.page(pageCount))
            return result
        }
        result.append(.page(1))
        result.append(.ellipsis(after: 1))
        if !hasRightGap {
            let start = pageCount - edgeCount + 1
            result.append(contentsOf: (start...pageCount).map { AedstPaginationItem.page($0) })
            return result
        }
        result.append(contentsOf: (left...right).map { AedstPaginationItem.page($0) })
        result.append(.ellipsis(after: right))
        result.append(.page(pageCount))
        return result
    }
}

#Preview("AedstPagination") {
    @Previewable @State var page = 5
    VStack(spacing: AedstSpacing.lg) {
        AedstPagination(page: $page, pageCount: 10)
        AedstPagination(page: .constant(1), pageCount: 3)
    }
    .padding()
}

#endif
