import Foundation
import TasksDomain

/// Localized display strings shared by the task screens of both UI builds.
public enum TaskFormatting {
    public static func priority(_ priority: TaskItem.Priority) -> String {
        switch priority {
        case .low: String(localized: "tasksPriorityLow", bundle: .module)
        case .medium: String(localized: "tasksPriorityMedium", bundle: .module)
        case .high: String(localized: "tasksPriorityHigh", bundle: .module)
        case .urgent: String(localized: "tasksPriorityUrgent", bundle: .module)
        }
    }

    public static func status(_ status: TaskItem.Status) -> String {
        switch status {
        case .todo: String(localized: "tasksStatusTodo", bundle: .module)
        case .inProgress: String(localized: "tasksStatusInProgress", bundle: .module)
        case .done: String(localized: "tasksStatusDone", bundle: .module)
        }
    }

    public static func due(_ date: Date) -> String {
        let formatted = date.formatted(date: .abbreviated, time: .omitted)
        return String(localized: "tasksDue \(formatted)", bundle: .module)
    }
}
