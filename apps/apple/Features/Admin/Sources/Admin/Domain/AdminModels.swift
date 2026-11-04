import AedstCore
import Foundation

/// `GetOverviewResponse`: operator dashboard numbers.
public struct AdminOverview: Sendable, Equatable {
    public let tasksTotal: Int64
    public let tasksDone: Int64
    public let tasksOverdue: Int64
    public let mediaTotal: Int64
    public let mediaBytes: Int64
    public let pushDevices: Int64
    public let outboxLagSeconds: Int64
    public let jobsPending: Int64

    /// Memberwise initializer.
    public init(
        tasksTotal: Int64, tasksDone: Int64, tasksOverdue: Int64,
        mediaTotal: Int64, mediaBytes: Int64, pushDevices: Int64, outboxLagSeconds: Int64, jobsPending: Int64
    ) {
        self.tasksTotal = tasksTotal
        self.tasksDone = tasksDone
        self.tasksOverdue = tasksOverdue
        self.mediaTotal = mediaTotal
        self.mediaBytes = mediaBytes
        self.pushDevices = pushDevices
        self.outboxLagSeconds = outboxLagSeconds
        self.jobsPending = jobsPending
    }
}

/// Any user's task (cross-tenant read).
public struct AdminTask: Sendable, Equatable, Identifiable {
    public let id: String
    public let ownerID: String
    public let title: String
    /// `aedst.tasks.v1.TaskStatus` number (3 = done).
    public let status: Int32
    public let createdAt: Date?

    /// Memberwise initializer.
    public init(id: String, ownerID: String, title: String, status: Int32, createdAt: Date?) {
        self.id = id
        self.ownerID = ownerID
        self.title = title
        self.status = status
        self.createdAt = createdAt
    }

    /// `true` when `status` is `TASK_STATUS_DONE`.
    public var isDone: Bool { status == 3 }
}

/// One audit-log row (every mutating admin RPC writes one).
public struct AuditEntry: Sendable, Equatable, Identifiable {
    public let id: String
    public let actorID: String
    public let action: String
    public let targetKind: String
    public let targetID: String
    public let reason: String
    public let createdAt: Date?

    /// Memberwise initializer.
    public init(id: String, actorID: String, action: String, targetKind: String, targetID: String, reason: String, createdAt: Date?) {
        self.id = id
        self.actorID = actorID
        self.action = action
        self.targetKind = targetKind
        self.targetID = targetID
        self.reason = reason
        self.createdAt = createdAt
    }
}

/// `BroadcastNotification` input.
public struct Broadcast: Sendable, Equatable {
    /// Empty means every user.
    public var userID: String
    public var title: String
    public var body: String
    /// Relative in-app route (`/tasks/...`) or empty.
    public var link: String

    /// Memberwise initializer.
    public init(userID: String = "", title: String = "", body: String = "", link: String = "") {
        self.userID = userID
        self.title = title
        self.body = body
        self.link = link
    }

    /// Mirrors the proto rules (title 1–120, body ≤ 1000, link relative ≤ 500).
    public var isValid: Bool {
        let trimmedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let linkIsValid = link.isEmpty || (link.hasPrefix("/") && !link.hasPrefix("//") && link.count <= 500)
        return !trimmedTitle.isEmpty && trimmedTitle.count <= 120 && body.count <= 1_000 && linkIsValid
    }
}

/// The seam to `AdminService`. Every RPC needs the `admin` role — enforced by
/// the server's RoleInterceptor; the client only hides the entry point.
public protocol AdminRepository: Sendable {
    func overview() async -> Outcome<AdminOverview>
    func tasks(query: String, pageToken: String?) async -> Outcome<Page<AdminTask>>
    func deleteTask(id: String, reason: String) async -> Outcome<Void>
    /// Returns the number of recipients.
    func broadcast(_ broadcast: Broadcast) async -> Outcome<Int64>
    func auditLog(pageToken: String?) async -> Outcome<Page<AuditEntry>>
}
