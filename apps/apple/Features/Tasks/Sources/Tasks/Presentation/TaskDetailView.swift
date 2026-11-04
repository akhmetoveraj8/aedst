import AedstDesignSystem
import SwiftUI

/// Task detail. `attachments` is a slot the composition root fills with the
/// Media feature's attachments view — this feature never imports Media.
public struct TaskDetailView<Attachments: View>: View {
    @State private var viewModel: TaskDetailViewModel
    @State private var isConfirmingDelete = false
    private let attachments: (String) -> Attachments
    private let onDeleted: () -> Void

    /// `attachments` receives the task id.
    public init(
        viewModel: TaskDetailViewModel,
        onDeleted: @escaping () -> Void,
        @ViewBuilder attachments: @escaping (String) -> Attachments
    ) {
        self._viewModel = State(wrappedValue: viewModel)
        self.onDeleted = onDeleted
        self.attachments = attachments
    }

    public var body: some View {
        @Bindable var viewModel = viewModel

        ScrollView {
            VStack(alignment: .leading, spacing: AedstSpacing.lg) {
                if let task = viewModel.task {
                    header(task)
                    if !task.details.isEmpty {
                        Text(task.details)
                            .aedstFont(AedstTypography.body)
                            .aedstSensitive()
                    }
                    AedstButton(
                        task.status == .done
                            ? String(localized: "tasksReopen", bundle: .module)
                            : String(localized: "tasksComplete", bundle: .module),
                        systemImage: task.status == .done ? "arrow.uturn.backward" : "checkmark",
                        variant: task.status == .done ? .outline : .primary,
                        isLoading: viewModel.isWorking
                    ) {
                        Task { await viewModel.toggleCompletion() }
                    }

                    AedstSeparator()
                    Text(String(localized: "tasksAttachments", bundle: .module))
                        .aedstFont(AedstTypography.headline)
                        .accessibilityAddTraits(.isHeader)
                    attachments(task.id)
                } else {
                    AedstSkeleton().frame(height: 32)
                    AedstSkeleton().frame(height: 80)
                }
            }
            .padding(AedstSpacing.lg)
            .frame(maxWidth: 720, alignment: .leading)
        }
        .navigationTitle(String(localized: "tasksDetailTitle", bundle: .module))
        .toolbar {
            ToolbarItem(placement: .destructiveAction) {
                Button(role: .destructive) {
                    isConfirmingDelete = true
                } label: {
                    Label(String(localized: "tasksDelete", bundle: .module), systemImage: "trash")
                }
            }
        }
        .confirmationDialog(
            String(localized: "tasksDeleteConfirm", bundle: .module),
            isPresented: $isConfirmingDelete,
            titleVisibility: .visible
        ) {
            Button(String(localized: "tasksDelete", bundle: .module), role: .destructive) {
                Task {
                    if await viewModel.delete() { onDeleted() }
                }
            }
        }
        .aedstErrorPresenter($viewModel.error)
        .task { await viewModel.load() }
    }

    private func header(_ task: TaskItem) -> some View {
        VStack(alignment: .leading, spacing: AedstSpacing.xs) {
            Text(task.title)
                .aedstFont(AedstTypography.title)
                .accessibilityAddTraits(.isHeader)
                .aedstSensitive()
            HStack(spacing: AedstSpacing.xs) {
                AedstBadge(TaskFormatting.status(task.status), variant: task.status == .done ? .default : .outline)
                AedstBadge(TaskFormatting.priority(task.priority), variant: .secondary)
                if let dueDate = task.dueDate {
                    Text(TaskFormatting.due(dueDate))
                        .aedstFont(AedstTypography.caption)
                        .foregroundStyle(viewModel.isOverdue(task) ? AedstColor.destructive : AedstColor.mutedForeground)
                        .aedstSensitive()
                }
            }
        }
    }
}
