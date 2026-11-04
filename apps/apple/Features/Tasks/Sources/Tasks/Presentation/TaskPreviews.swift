#if DEBUG
import AedstCore
import SwiftUI

/// In-memory repository for Xcode Previews: a few fixed rows, every write succeeds. Debug builds only.
struct PreviewTaskRepository: TaskRepository {
    static let sample: [TaskItem] = [
        TaskItem(id: "p1", title: "Plan the release", priority: .high),
        TaskItem(id: "p2", title: "Review the pull request", status: .inProgress),
        TaskItem(id: "p3", title: "Send the invoice", status: .done, priority: .low),
        TaskItem(id: "p4", title: "Renew the certificate", priority: .urgent, dueDate: Date(timeIntervalSince1970: 1_700_000_000)),
    ]

    func list(search: String, pageToken: String?) async -> Outcome<Page<TaskItem>> {
        .success(Page(items: Self.sample, nextPageToken: nil))
    }

    func get(id: String) async -> Outcome<TaskItem> {
        Self.sample.first { $0.id == id }.map { .success($0) } ?? .failure(.notFound)
    }

    func create(_ task: NewTask, idempotencyKey: String?) async -> Outcome<TaskItem> {
        .success(TaskItem(id: "new", title: task.title, priority: task.priority))
    }

    func complete(id: String) async -> Outcome<TaskItem> { await get(id: id) }
    func reopen(id: String) async -> Outcome<TaskItem> { await get(id: id) }
    func delete(id: String, idempotencyKey: String?) async -> Outcome<Void> { .success(()) }
}

#Preview("Task list") {
    NavigationStack {
        TaskListView(viewModel: TaskListViewModel(repository: PreviewTaskRepository())) { _ in }
    }
}

#Preview("Task detail") {
    NavigationStack {
        TaskDetailView(
            viewModel: TaskDetailViewModel(taskID: "p1", repository: PreviewTaskRepository()),
            onDeleted: {}
        ) { _ in
            EmptyView()
        }
    }
}
#endif
