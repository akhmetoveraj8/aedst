import SwiftUI

// iOS, macOS and visionOS only: tvOS and watchOS are scaffolded package platforms without app targets.
#if os(iOS) || os(macOS) || os(visionOS)

/// Static table matching shadcn/ui `Table`: a tokenized `Grid`, so columns line up on every platform (SwiftUI's
/// own `Table` collapses to its first column on iPhone). Compose it from `AedstTableHeader`, `AedstTableRow`,
/// `AedstTableHead` and `AedstTableCell`; use `AedstDataTable` for sorting, selection and paging.
///
/// The table scrolls horizontally only when its columns do not fit the available width.
public struct AedstTable<Content: View>: View {
    private let caption: String?
    private let content: Content

    /// - Parameters:
    ///   - caption: Optional description shown under the table (shadcn `TableCaption`); it also names the
    ///     table for assistive technologies.
    ///   - content: `AedstTableHeader` and `AedstTableRow` values, top to bottom.
    public init(caption: String? = nil, @ViewBuilder content: () -> Content) {
        self.caption = caption
        self.content = content()
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: AedstSpacing.sm) {
            ViewThatFits(in: .horizontal) {
                grid
                ScrollView(.horizontal) {
                    grid
                }
            }
            if let caption {
                Text(caption)
                    .font(AedstTypography.caption)
                    .foregroundStyle(AedstColor.mutedForeground)
                    .frame(maxWidth: .infinity, alignment: .center)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(caption ?? ""))
    }

    private var grid: some View {
        Grid(alignment: .leading, horizontalSpacing: AedstSpacing.none, verticalSpacing: AedstSpacing.none) {
            content
        }
        .font(AedstTypography.body)
        .foregroundStyle(AedstColor.foreground)
    }
}

/// Header row of an `AedstTable` (shadcn `TableHeader` + its `TableRow`), followed by a rule.
public struct AedstTableHeader<Content: View>: View {
    private let content: Content

    /// - Parameter content: One `AedstTableHead` per column.
    public init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    public var body: some View {
        GridRow {
            content
        }
        AedstTableRule()
    }
}

/// Body row of an `AedstTable` (shadcn `TableRow`), followed by a rule.
public struct AedstTableRow<Content: View>: View {
    private let content: Content

    /// - Parameter content: One `AedstTableCell` per column.
    public init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    public var body: some View {
        GridRow {
            content
        }
        AedstTableRule()
    }
}

/// Column heading (shadcn `TableHead`). Its alignment becomes the alignment of the whole column.
public struct AedstTableHead: View {
    private let title: String
    private let alignment: HorizontalAlignment

    /// - Parameters:
    ///   - title: Already localized column title.
    ///   - alignment: Alignment of the column (`.trailing` for numbers).
    public init(_ title: String, alignment: HorizontalAlignment = .leading) {
        self.title = title
        self.alignment = alignment
    }

    public var body: some View {
        Text(title)
            .font(AedstTypography.caption.weight(.medium))
            .foregroundStyle(AedstColor.mutedForeground)
            .padding(.horizontal, AedstSpacing.sm)
            .padding(.vertical, AedstSpacing.sm)
            .gridColumnAlignment(alignment)
            .accessibilityAddTraits(.isHeader)
    }
}

/// Body cell (shadcn `TableCell`).
public struct AedstTableCell<Content: View>: View {
    private let content: Content

    /// - Parameter content: The cell's content.
    public init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    public var body: some View {
        content
            .padding(.horizontal, AedstSpacing.sm)
            .padding(.vertical, AedstSpacing.sm)
    }
}

extension AedstTableCell where Content == Text {
    /// A plain text cell.
    public init(_ text: String) {
        self.init { Text(text) }
    }
}

/// Rule under a row. A view outside a `GridRow` spans every column; it must not widen the grid.
private struct AedstTableRule: View {
    var body: some View {
        AedstSeparator()
            .gridCellUnsizedAxes(.horizontal)
    }
}

#Preview("AedstTable") {
    AedstTable(caption: "A list of your recent invoices.") {
        AedstTableHeader {
            AedstTableHead("Invoice")
            AedstTableHead("Status")
            AedstTableHead("Amount", alignment: .trailing)
        }
        AedstTableRow {
            AedstTableCell("INV-001")
            AedstTableCell("Paid")
            AedstTableCell("$250.00")
        }
        AedstTableRow {
            AedstTableCell("INV-002")
            AedstTableCell("Pending")
            AedstTableCell("$150.00")
        }
    }
    .padding()
}

#endif
