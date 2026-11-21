// Pixel snapshots of the data-display and layout components. Same rules as ComponentSnapshotTests.swift:
// iOS Simulator and macOS only, variants and the helper live in SnapshotSupport.swift, and no reference
// images exist yet (they are recorded on a Mac; see README.md in this folder).
#if os(iOS) || os(macOS)
import AedstDesignSystem
import Foundation
import SnapshotTesting
import SwiftUI
import Testing

private struct InvoiceRow: Identifiable {
    let id: String
    let status: String
    let amount: String
}

private struct Slide: Identifiable {
    let id: Int
}

/// One image per component x variant (iPhone, iPad, macOS; light/dark; large Dynamic Type; RTL).
@MainActor
@Suite(
    "Data snapshots",
    .serialized,
    // Skipped (not failed) while no references are recorded; AEDST_SNAPSHOTS=verify|record|skip overrides.
    .enabled(if: SnapshotMode.shouldRun(suite: "DataSnapshotTests"), "no reference images recorded yet (see Snapshots/README.md)")
)
struct DataSnapshotTests {
    private let rows = [
        InvoiceRow(id: "INV-001", status: "Paid", amount: "$250.00"),
        InvoiceRow(id: "INV-002", status: "Pending", amount: "$150.00"),
    ]

    /// A fixed instant, so the calendar and the date field do not depend on the day the test runs.
    private let date = Date(timeIntervalSinceReferenceDate: 800_000_000)

    @Test("AedstTable")
    func table() {
        assertComponent(height: 260) {
            AedstTable(caption: "Recent invoices") {
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
        }
    }

    @Test("AedstDataTable")
    func dataTable() {
        let columns = [
            AedstDataTableColumn<InvoiceRow>(id: "invoice", title: "Invoice", isSortable: true, text: { $0.id }),
            AedstDataTableColumn<InvoiceRow>(id: "status", title: "Status", text: { $0.status }),
            AedstDataTableColumn<InvoiceRow>(
                id: "amount", title: "Amount", alignment: .trailing, isSortable: true, text: { $0.amount }
            ),
        ]
        assertComponent(height: 520) {
            VStack(alignment: .leading, spacing: AedstSpacing.xxl) {
                AedstDataTable(
                    rows: rows,
                    columns: columns,
                    sort: Binding.constant(AedstDataTableSort(columnID: "invoice")),
                    selection: Binding.constant(["INV-002"]),
                    page: Binding.constant(2),
                    pageCount: 4
                )
                AedstDataTable(rows: [], columns: columns)
            }
        }
    }

    @Test("AedstPagination")
    func pagination() {
        assertComponent(height: 260) {
            VStack(alignment: .leading, spacing: AedstSpacing.lg) {
                AedstPagination(page: .constant(1), pageCount: 3)
                AedstPagination(page: .constant(5), pageCount: 10)
                AedstPagination(page: .constant(10), pageCount: 10)
            }
        }
    }

    @Test("AedstBreadcrumb")
    func breadcrumb() {
        let trail = ["Home", "Projects", "Apollo", "Tasks", "Checklist"].map { AedstBreadcrumbItem(id: $0, title: $0) }
        assertComponent(height: 200) {
            VStack(alignment: .leading, spacing: AedstSpacing.lg) {
                AedstBreadcrumb(items: Array(trail.prefix(3))) { _ in }
                AedstBreadcrumb(items: trail, maxVisible: 3) { _ in }
            }
        }
    }

    @Test("AedstCarousel")
    func carousel() {
        assertComponent(height: 280) {
            AedstCarousel([Slide(id: 1), Slide(id: 2), Slide(id: 3)], selection: .constant(0)) { slide in
                AedstCard {
                    Text(verbatim: "\(slide.id)")
                        .frame(maxWidth: .infinity, minHeight: 120)
                }
            }
        }
    }

    @Test("AedstChart")
    func chart() {
        let points = ["Jan", "Feb", "Mar"].enumerated().flatMap { index, month in
            [
                AedstChartPoint(category: month, value: Double(4 + index * 2), series: "Done"),
                AedstChartPoint(category: month, value: Double(6 - index), series: "Open"),
            ]
        }
        assertComponent(height: 900) {
            VStack(spacing: AedstSpacing.lg) {
                AedstChart("Bars", points: points, categoryLabel: "Month", valueLabel: "Tasks")
                AedstChart("Lines", points: points, kind: .line, categoryLabel: "Month", valueLabel: "Tasks")
                AedstChart("Empty", points: [], categoryLabel: "Month", valueLabel: "Tasks", height: 80)
            }
        }
    }

    @Test("AedstResizable")
    func resizable() {
        assertComponent(height: 360) {
            VStack(spacing: AedstSpacing.lg) {
                AedstResizable(fraction: .constant(0.3)) {
                    AedstColor.muted
                } second: {
                    AedstColor.accent
                }
                AedstResizable(axis: .vertical, fraction: .constant(0.6)) {
                    AedstColor.muted
                } second: {
                    AedstColor.accent
                }
            }
        }
    }

    @Test("AedstSidebar")
    func sidebar() {
        assertComponent(height: 460) {
            AedstSidebar {
                Text(verbatim: "AEDST").font(AedstTypography.headline)
            } content: {
                AedstSidebarGroup("Workspace") {
                    AedstSidebarMenuButton("Inbox", systemImage: "tray", badge: "12", isActive: true) {}
                    AedstSidebarMenuButton("Tasks", systemImage: "checklist") {}
                    AedstSidebarMenuButton("Small", systemImage: "archivebox", size: .sm) {}
                    AedstSidebarMenuButton("Large outline", systemImage: "gear", variant: .outline, size: .lg) {}
                }
            } footer: {
                AedstSidebarTrigger(isOpen: .constant(true))
            }
            .frame(width: 260)
        }
    }

    @Test("AedstCodeBlock")
    func codeBlock() {
        let code = "let answer = 42\n\nfunc greet() {\n    log(answer)\n}\n"
        assertComponent(height: 420) {
            VStack(spacing: AedstSpacing.lg) {
                AedstCodeBlock(
                    code, filename: "Answer.swift", language: "Swift", showsLineNumbers: true, highlightedLines: [4]
                )
                AedstCodeBlock("pnpm install", showsWrapToggle: false, showsCopyButton: false)
            }
        }
    }

    @Test("AedstScrollArea and AedstAspectRatio")
    func scrollAreaAndAspectRatio() {
        assertComponent(height: 420) {
            VStack(spacing: AedstSpacing.lg) {
                AedstScrollArea {
                    VStack(alignment: .leading, spacing: AedstSpacing.sm) {
                        ForEach(1..<12) { index in
                            Text(verbatim: "Row \(index)")
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .frame(height: 120)
                AedstAspectRatio(16 / 9) {
                    AedstColor.muted
                }
            }
        }
    }

    @Test("AedstCalendar and AedstDatePicker")
    func calendarAndDatePicker() {
        assertComponent(height: 640) {
            VStack(alignment: .leading, spacing: AedstSpacing.lg) {
                AedstCalendar("Due date", selection: .constant(date))
                AedstDatePicker("Due date", selection: .constant(date), helperText: "End of the day.")
                AedstDatePicker("Reminder", selection: .constant(date), errorMessage: "Pick a future time.")
            }
            // Pinned, so the month grid does not follow the machine's region and time zone.
            .environment(\.calendar, Calendar(identifier: .gregorian))
            .environment(\.timeZone, TimeZone(secondsFromGMT: 0) ?? .gmt)
        }
    }
}
#endif
