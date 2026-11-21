#if os(macOS)
import AdminDomain
import AdminPresentation
import AedstDesignSystem
import AedstNavigation
import SwiftUI

/// Operator dashboard. Only reachable when the access token carries the
/// `admin` role (checked by the app target); the server enforces it regardless.
public struct AdminDashboardView: View {
    @State private var viewModel: AdminDashboardViewModel
    private let onNavigate: (AdminRoute) -> Void

    /// `onNavigate` pushes the selected admin section.
    public init(viewModel: AdminDashboardViewModel, onNavigate: @escaping (AdminRoute) -> Void) {
        self._viewModel = State(wrappedValue: viewModel)
        self.onNavigate = onNavigate
    }

    public var body: some View {
        @Bindable var viewModel = viewModel
        List {
            Section(String(localized: "adminOverview", bundle: AdminStrings.bundle)) {
                if let overview = viewModel.overview {
                    stat("adminTasksTotal", "\(overview.tasksTotal)")
                    stat("adminTasksDone", "\(overview.tasksDone)")
                    stat("adminTasksOverdue", "\(overview.tasksOverdue)")
                    stat("adminMedia", ByteCountFormatter.string(fromByteCount: overview.mediaBytes, countStyle: .file))
                    stat("adminPushDevices", "\(overview.pushDevices)")
                    stat("adminOutboxLag", outboxLag(overview))
                    stat("adminJobsPending", "\(overview.jobsPending)")
                } else {
                    AedstSkeleton().frame(height: 120)
                }
            }
            Section {
                row("adminTasks", "checklist", .tasks)
                row("adminBroadcast", "megaphone", .broadcast)
                row("adminAuditLog", "list.bullet.rectangle", .auditLog)
            }
        }
        // No pull-to-refresh on the Mac: Refresh is a toolbar button (Command-R).
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    Task { await viewModel.load() }
                } label: {
                    Label(String(localized: "adminRefresh", bundle: AdminStrings.bundle), systemImage: "arrow.clockwise")
                }
                .keyboardShortcut("r", modifiers: .command)
            }
        }
        .navigationTitle(String(localized: "adminTitle", bundle: AdminStrings.bundle))
        .aedstErrorPresenter($viewModel.error)
        .task { await viewModel.load() }
    }

    /// Locale-aware unit ("12 sec" in English, the localized abbreviation elsewhere), not a hard-coded "s".
    private func outboxLag(_ overview: AdminOverview) -> String {
        Duration.seconds(overview.outboxLagSeconds).formatted(.units(allowed: [.seconds], width: .abbreviated))
    }

    private func stat(_ key: String.LocalizationValue, _ value: String) -> some View {
        HStack {
            Text(String(localized: key, bundle: AdminStrings.bundle))
            Spacer()
            Text(value).foregroundStyle(AedstColor.mutedForeground).monospacedDigit()
        }
        .accessibilityElement(children: .combine)
    }

    private func row(_ key: String.LocalizationValue, _ icon: String, _ route: AdminRoute) -> some View {
        Button {
            onNavigate(route)
        } label: {
            Label(String(localized: key, bundle: AdminStrings.bundle), systemImage: icon)
        }
    }
}

/// Any user's tasks; deletion asks for a reason (audit log).
public struct AdminTasksView: View {
    @State private var viewModel: AdminTasksViewModel

    /// Creates the screen.
    public init(viewModel: AdminTasksViewModel) {
        self._viewModel = State(wrappedValue: viewModel)
    }

    public var body: some View {
        @Bindable var viewModel = viewModel
        List(viewModel.list.items) { task in
            HStack {
                Image(systemName: task.isDone ? "checkmark.circle.fill" : "circle").accessibilityHidden(true)
                Text(task.title)
                    .aedstSensitive()
                Spacer()
                Button(role: .destructive) {
                    viewModel.pendingDeletion = task
                } label: {
                    Label(String(localized: "adminDeleteTask", bundle: AdminStrings.bundle), systemImage: "trash")
                        .labelStyle(.iconOnly)
                }
                .buttonStyle(.borderless)
            }
            .task { await viewModel.loadMoreIfNeeded(after: task) }
        }
        .searchable(text: $viewModel.query)
        .onSubmit(of: .search) { Task { await viewModel.search() } }
        .navigationTitle(String(localized: "adminTasks", bundle: AdminStrings.bundle))
        .aedstSheet(item: $viewModel.pendingDeletion) { task in
            DeletionReasonSheet(viewModel: viewModel, title: task.title)
        }
        .aedstErrorPresenter($viewModel.error)
        .task { if !viewModel.list.hasLoaded { await viewModel.search() } }
    }
}

private struct DeletionReasonSheet: View {
    let viewModel: AdminTasksViewModel
    let title: String
    @FocusState private var reasonFocused: Bool

    var body: some View {
        @Bindable var viewModel = viewModel
        VStack(alignment: .leading, spacing: AedstSpacing.lg) {
            Text(String(localized: "adminDeleteTaskTitle \(title)", bundle: AdminStrings.bundle))
                .aedstFont(AedstTypography.title)
                .aedstSensitive()
            AedstTextField(String(localized: "adminDeleteReason", bundle: AdminStrings.bundle), text: $viewModel.deletionReason)
                .focused($reasonFocused)
                .aedstSensitive()
            HStack {
                AedstButton(String(localized: "adminCancel", bundle: AdminStrings.bundle), variant: .ghost) {
                    viewModel.pendingDeletion = nil
                }
                AedstButton(
                    String(localized: "adminDeleteTask", bundle: AdminStrings.bundle),
                    variant: .destructive,
                    isDisabled: !viewModel.isReasonValid
                ) {
                    Task { await viewModel.confirmDeletion() }
                }
            }
            Spacer()
        }
        .padding(AedstSpacing.xxl)
        .frame(minWidth: 320, minHeight: 240)
        // The sheet asks for a reason, so start in that field.
        .defaultFocus($reasonFocused, true)
    }
}

/// The audit log.
public struct AdminAuditLogView: View {
    @State private var viewModel: AdminAuditLogViewModel

    /// Creates the screen.
    public init(viewModel: AdminAuditLogViewModel) {
        self._viewModel = State(wrappedValue: viewModel)
    }

    public var body: some View {
        @Bindable var viewModel = viewModel
        List(viewModel.list.items) { entry in
            VStack(alignment: .leading, spacing: AedstSpacing.xxs) {
                // Server-defined identifiers (action code, target kind), not translatable copy.
                Text(verbatim: "\(entry.action) · \(entry.targetKind)").aedstFont(AedstTypography.body)
                if !entry.reason.isEmpty {
                    Text(entry.reason).aedstFont(AedstTypography.caption)
                }
                if let createdAt = entry.createdAt {
                    Text(createdAt.formatted(date: .abbreviated, time: .shortened))
                        .aedstFont(AedstTypography.caption)
                        .foregroundStyle(AedstColor.mutedForeground)
                }
            }
            .accessibilityElement(children: .combine)
            .aedstSensitive()
            .task { await viewModel.loadMoreIfNeeded(after: entry) }
        }
        // No pull-to-refresh on the Mac: Refresh is a toolbar button (Command-R).
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    Task { await viewModel.refresh() }
                } label: {
                    Label(String(localized: "adminRefresh", bundle: AdminStrings.bundle), systemImage: "arrow.clockwise")
                }
                .keyboardShortcut("r", modifiers: .command)
            }
        }
        .navigationTitle(String(localized: "adminAuditLog", bundle: AdminStrings.bundle))
        .aedstErrorPresenter($viewModel.error)
        .task { if !viewModel.list.hasLoaded { await viewModel.refresh() } }
    }
}

/// Broadcast form.
public struct AdminBroadcastView: View {
    @State private var viewModel: AdminBroadcastViewModel
    @State private var toast: AedstToastData?

    /// Creates the screen.
    public init(viewModel: AdminBroadcastViewModel) {
        self._viewModel = State(wrappedValue: viewModel)
    }

    public var body: some View {
        @Bindable var viewModel = viewModel
        ScrollView {
            VStack(alignment: .leading, spacing: AedstSpacing.lg) {
                VStack(alignment: .leading, spacing: AedstSpacing.lg) {
                    AedstTextField(String(localized: "adminBroadcastUser", bundle: AdminStrings.bundle), text: $viewModel.draft.userID,
                                   helperText: String(localized: "adminBroadcastUserHelp", bundle: AdminStrings.bundle))
                    AedstTextField(String(localized: "adminBroadcastTitleField", bundle: AdminStrings.bundle), text: $viewModel.draft.title)
                    AedstTextField(String(localized: "adminBroadcastBody", bundle: AdminStrings.bundle), text: $viewModel.draft.body)
                    AedstTextField(String(localized: "adminBroadcastLink", bundle: AdminStrings.bundle), text: $viewModel.draft.link,
                                   placeholder: "/tasks")
                }
                .aedstSensitive()
                AedstButton(
                    String(localized: "adminBroadcastSend", bundle: AdminStrings.bundle),
                    systemImage: "paperplane",
                    isLoading: viewModel.isSending,
                    isDisabled: !viewModel.draft.isValid
                ) {
                    Task {
                        await viewModel.send()
                        if let recipients = viewModel.lastRecipients, viewModel.error == nil {
                            toast = AedstToastData(
                                title: String(localized: "adminBroadcastSent \(recipients)", bundle: AdminStrings.bundle),
                                severity: .success
                            )
                        }
                    }
                }
            }
            .padding(AedstSpacing.lg)
            .frame(maxWidth: 640, alignment: .leading)
        }
        .navigationTitle(String(localized: "adminBroadcast", bundle: AdminStrings.bundle))
        .aedstToast($toast)
        .aedstErrorPresenter($viewModel.error)
    }
}
#endif
