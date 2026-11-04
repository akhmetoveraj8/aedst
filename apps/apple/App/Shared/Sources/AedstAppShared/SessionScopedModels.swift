import Tasks

/// View models that must outlive one screen, so that screens showing the same data share it: the task list is
/// the source for the detail screen's `onChange`/`onDelete`, and a list that was rebuilt on every navigation
/// would never see those callbacks. Owned by `AppDependencies`; `reset()` runs on sign-out so the next user
/// never sees the previous user's rows.
@MainActor
final class SessionScopedModels {
    private var taskList: TaskListViewModel?

    /// The session's task list, built by `make` on first use.
    func taskList(make: () -> TaskListViewModel) -> TaskListViewModel {
        if let taskList { return taskList }
        let created = make()
        taskList = created
        return created
    }

    func reset() {
        taskList = nil
    }
}
