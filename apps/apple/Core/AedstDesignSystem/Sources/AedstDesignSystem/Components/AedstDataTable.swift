import SwiftUI

// iOS, macOS and visionOS only: tvOS and watchOS are scaffolded package platforms without app targets.
#if os(iOS) || os(macOS) || os(visionOS)

/// One column of an `AedstDataTable`: a title and a cell builder.
public struct AedstDataTableColumn<Row> {
    /// Stable identifier, also used as the sort key reported in `AedstDataTableSort`.
    public let id: String
    /// Already localized column title.
    public let title: String
    /// Alignment of the column (`.trailing` for numbers).
    public let alignment: HorizontalAlignment
    /// Whether the header is a button that changes the sort.
    public let isSortable: Bool
    let cell: @MainActor (Row) -> AnyView

    /// A column with a custom cell. The cell is type-erased so columns with different cells fit one array.
    public init<Cell: View>(
        id: String,
        title: String,
        alignment: HorizontalAlignment = .leading,
        isSortable: Bool = false,
        @ViewBuilder cell: @escaping @MainActor (Row) -> Cell
    ) {
        self.id = id
        self.title = title
        self.alignment = alignment
        self.isSortable = isSortable
        self.cell = { AnyView(cell($0)) }
    }

    /// A plain text column.
    public init(
        id: String,
        title: String,
        alignment: HorizontalAlignment = .leading,
        isSortable: Bool = false,
        text: @escaping @MainActor (Row) -> String
    ) {
        self.init(id: id, title: title, alignment: alignment, isSortable: isSortable, cell: { row in
            Text(text(row))
        })
    }
}

/// The sort an `AedstDataTable` shows and requests. The table does not reorder rows itself: the owner (a
/// view model, usually asking the server) sorts and passes the rows back.
public struct AedstDataTableSort: Equatable, Sendable {
    /// `AedstDataTableColumn.id` of the sorted column.
    public let columnID: String
    public let isAscending: Bool

    public init(columnID: String, isAscending: Bool = true) {
        self.columnID = columnID
        self.isAscending = isAscending
    }

    /// What tapping the header of `columnID` leads to: ascending, then descending, then unsorted.
    static func next(after current: AedstDataTableSort?, columnID: String) -> AedstDataTableSort? {
        guard let current, current.columnID == columnID else {
            return AedstDataTableSort(columnID: columnID, isAscending: true)
        }
        return current.isAscending ? AedstDataTableSort(columnID: columnID, isAscending: false) : nil
    }
}

/// Selection arithmetic of `AedstDataTable`, kept out of the generic view so it can be unit-tested.
enum AedstDataTableSelection {
    /// `true` when every visible row is selected (and there is at least one).
    static func isAllSelected<ID: Hashable>(_ selection: Set<ID>, visible: [ID]) -> Bool {
        !visible.isEmpty && visible.allSatisfy { selection.contains($0) }
    }

    /// The "select all" checkbox: selects every visible row, or deselects them if all were selected.
    /// Rows selected on other pages stay selected.
    static func togglingAll<ID: Hashable>(_ selection: Set<ID>, visible: [ID]) -> Set<ID> {
        isAllSelected(selection, visible: visible) ? selection.subtracting(visible) : selection.union(visible)
    }

    static func toggling<ID: Hashable>(_ selection: Set<ID>, id: ID) -> Set<ID> {
        var result = selection
        if result.remove(id) == nil { result.insert(id) }
        return result
    }
}

/// Data grid matching shadcn/ui `DataTable`: `AedstTable` with sortable headers, row selection, an empty
/// state and `AedstPagination`. Sorting and paging are controlled: the table reports the request through its
/// bindings and shows the rows it is given.
public struct AedstDataTable<Row: Identifiable>: View {
    private let rows: [Row]
    private let columns: [AedstDataTableColumn<Row>]
    private let sort: Binding<AedstDataTableSort?>?
    private let selection: Binding<Set<Row.ID>>?
    private let page: Binding<Int>?
    private let pageCount: Int
    private let caption: String?
    private let emptyText: String

    /// - Parameters:
    ///   - rows: The rows of the current page, already sorted.
    ///   - sort: Enables the sortable headers; `nil` makes every header plain text.
    ///   - selection: Enables the checkbox column.
    ///   - page: Enables the pager (1-based), together with `pageCount`.
    ///   - emptyText: Shown instead of rows when `rows` is empty; defaults to "No results".
    public init(
        rows: [Row],
        columns: [AedstDataTableColumn<Row>],
        sort: Binding<AedstDataTableSort?>? = nil,
        selection: Binding<Set<Row.ID>>? = nil,
        page: Binding<Int>? = nil,
        pageCount: Int = 1,
        caption: String? = nil,
        emptyText: String? = nil
    ) {
        self.rows = rows
        self.columns = columns
        self.sort = sort
        self.selection = selection
        self.page = page
        self.pageCount = pageCount
        self.caption = caption
        self.emptyText = emptyText ?? AedstStrings.noResults
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: AedstSpacing.sm) {
            AedstTable(caption: caption) {
                AedstTableHeader {
                    if let selection {
                        selectAllCheckbox(selection)
                    }
                    ForEach(columns, id: \.id) { column in
                        header(column)
                    }
                }
                ForEach(rows) { row in
                    AedstTableRow {
                        if let selection {
                            rowCheckbox(selection, id: row.id)
                        }
                        ForEach(columns, id: \.id) { column in
                            AedstTableCell { column.cell(row) }
                        }
                    }
                }
                if rows.isEmpty {
                    Text(emptyText)
                        .font(AedstTypography.caption)
                        .foregroundStyle(AedstColor.mutedForeground)
                        .padding(AedstSpacing.xxl)
                        .frame(maxWidth: .infinity)
                        .gridCellUnsizedAxes(.horizontal)
                }
            }
            if let page {
                AedstPagination(page: page, pageCount: pageCount)
                    .frame(maxWidth: .infinity, alignment: .trailing)
            }
        }
    }

    @ViewBuilder
    private func header(_ column: AedstDataTableColumn<Row>) -> some View {
        if let sort, column.isSortable {
            let isSorted = sort.wrappedValue?.columnID == column.id
            let isAscending = sort.wrappedValue?.isAscending ?? true
            Button {
                sort.wrappedValue = AedstDataTableSort.next(after: sort.wrappedValue, columnID: column.id)
            } label: {
                HStack(spacing: AedstSpacing.xs) {
                    Text(column.title)
                    Image(systemName: isSorted ? (isAscending ? "arrow.up" : "arrow.down") : "arrow.up.arrow.down")
                        .accessibilityHidden(true)
                }
                .font(AedstTypography.caption.weight(.medium))
                .foregroundStyle(isSorted ? AedstColor.foreground : AedstColor.mutedForeground)
                .padding(.horizontal, AedstSpacing.sm)
                .aedstHitTarget()
            }
            .buttonStyle(.plain)
            .gridColumnAlignment(column.alignment)
            .accessibilityLabel(Text(AedstStrings.sortBy(column.title)))
            .accessibilityValue(
                Text(isSorted ? (isAscending ? AedstStrings.sortAscending : AedstStrings.sortDescending) : "")
            )
            .accessibilityAddTraits(.isHeader)
        } else {
            AedstTableHead(column.title, alignment: column.alignment)
        }
    }

    private func selectAllCheckbox(_ selection: Binding<Set<Row.ID>>) -> some View {
        let visible = rows.map(\.id)
        let isChecked = Binding<Bool>(
            get: { AedstDataTableSelection.isAllSelected(selection.wrappedValue, visible: visible) },
            set: { _ in
                selection.wrappedValue = AedstDataTableSelection.togglingAll(selection.wrappedValue, visible: visible)
            }
        )
        return AedstCheckbox(isChecked: isChecked, isDisabled: rows.isEmpty)
            .aedstHitTarget()
            .padding(.horizontal, AedstSpacing.xs)
            .accessibilityLabel(Text(AedstStrings.selectAllRows))
    }

    private func rowCheckbox(_ selection: Binding<Set<Row.ID>>, id: Row.ID) -> some View {
        let isChecked = Binding<Bool>(
            get: { selection.wrappedValue.contains(id) },
            set: { _ in selection.wrappedValue = AedstDataTableSelection.toggling(selection.wrappedValue, id: id) }
        )
        return AedstCheckbox(isChecked: isChecked)
            .aedstHitTarget()
            .padding(.horizontal, AedstSpacing.xs)
            .accessibilityLabel(Text(AedstStrings.selectRow))
    }
}

private struct AedstDataTablePreviewRow: Identifiable {
    let id: String
    let status: String
    let amount: String
}

#Preview("AedstDataTable") {
    @Previewable @State var sort: AedstDataTableSort? = AedstDataTableSort(columnID: "invoice")
    @Previewable @State var selection: Set<String> = ["INV-002"]
    @Previewable @State var page = 1
    AedstDataTable(
        rows: [
            AedstDataTablePreviewRow(id: "INV-001", status: "Paid", amount: "$250.00"),
            AedstDataTablePreviewRow(id: "INV-002", status: "Pending", amount: "$150.00"),
        ],
        columns: [
            AedstDataTableColumn(id: "invoice", title: "Invoice", isSortable: true, text: { $0.id }),
            AedstDataTableColumn(id: "status", title: "Status", cell: { row in AedstBadge(row.status, variant: .secondary) }),
            AedstDataTableColumn(id: "amount", title: "Amount", alignment: .trailing, isSortable: true, text: { $0.amount }),
        ],
        sort: $sort,
        selection: $selection,
        page: $page,
        pageCount: 4
    )
    .padding()
}

#endif
