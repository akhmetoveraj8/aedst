import AedstAnalytics
import AedstCore
import Foundation
import Testing
@testable import AdminData
@testable import AdminDomain
@testable import AdminPresentation

/// Scripted `AdminRepository`: every call is recorded, results are set per test.
actor FakeAdminRepository: AdminRepository {
    private var overviewResult: Outcome<AdminOverview> = .failure(.unavailable(reason: "offline"))
    private var taskPages: [String?: Page<AdminTask>] = [:]
    private var auditPages: [String?: Page<AuditEntry>] = [:]
    private var deleteResult: Outcome<Void> = .success(())
    private var broadcastResult: Outcome<Int64> = .success(0)

    private(set) var taskCalls: [String] = []
    private(set) var deletions: [String] = []
    private(set) var broadcasts: [Broadcast] = []

    func script(overview: Outcome<AdminOverview>) { overviewResult = overview }
    func script(tasks page: Page<AdminTask>, token: String?) { taskPages[token] = page }
    func script(audit page: Page<AuditEntry>, token: String?) { auditPages[token] = page }
    func script(delete: Outcome<Void>) { deleteResult = delete }
    func script(broadcast: Outcome<Int64>) { broadcastResult = broadcast }

    func overview() async -> Outcome<AdminOverview> { overviewResult }

    func tasks(query: String, pageToken: String?) async -> Outcome<Page<AdminTask>> {
        taskCalls.append("\(query)|\(pageToken ?? "-")")
        return taskPages[pageToken].map { .success($0) } ?? .failure(.unavailable(reason: "offline"))
    }

    func deleteTask(id: String, reason: String) async -> Outcome<Void> {
        deletions.append("\(id)|\(reason)")
        return deleteResult
    }

    func broadcast(_ broadcast: Broadcast) async -> Outcome<Int64> {
        broadcasts.append(broadcast)
        return broadcastResult
    }

    func auditLog(pageToken: String?) async -> Outcome<Page<AuditEntry>> {
        auditPages[pageToken].map { .success($0) } ?? .failure(.unavailable(reason: "offline"))
    }
}

private final class RecordingAnalytics: AnalyticsClient, @unchecked Sendable {
    private let lock = NSLock()
    private var names: [String] = []
    var events: [String] { lock.withLock { names } }

    func track(_ event: AnalyticsEvent) { lock.withLock { names.append(event.name) } }
    func setUserID(_ userID: String?) {}
    func recordError(_ error: Error, context: [String: String]) {}
}

private func task(_ id: String) -> AdminTask {
    AdminTask(id: id, ownerID: "u", title: id, status: 1, createdAt: nil)
}

private func entry(_ id: String) -> AuditEntry {
    AuditEntry(id: id, actorID: "a", action: "x", targetKind: "task", targetID: id, reason: "r", createdAt: nil)
}

@Suite("Admin dashboard")
@MainActor
struct AdminDashboardViewModelTests {
    @Test("load publishes the overview")
    func loads() async {
        let repository = FakeAdminRepository()
        let overview = AdminOverview(
            tasksTotal: 2, tasksDone: 1, tasksOverdue: 0,
            mediaTotal: 3, mediaBytes: 4, pushDevices: 5, outboxLagSeconds: 6, jobsPending: 7
        )
        await repository.script(overview: .success(overview))
        let model = AdminDashboardViewModel(repository: repository)

        await model.load()

        #expect(model.overview == overview)
        #expect(model.error == nil)
    }

    @Test("a revoked role surfaces as .forbidden and keeps the previous numbers")
    func forbidden() async {
        let repository = FakeAdminRepository()
        let model = AdminDashboardViewModel(repository: repository)
        await repository.script(overview: .failure(.forbidden))

        await model.load()

        #expect(model.error == .forbidden)
        #expect(model.overview == nil)
    }
}

@Suite("Admin tasks")
@MainActor
struct AdminTasksViewModelTests {
    private func makeModel(
        _ repository: FakeAdminRepository,
        analytics: RecordingAnalytics = RecordingAnalytics()
    ) async -> AdminTasksViewModel {
        await repository.script(tasks: Page(items: [task("t1"), task("t2")], nextPageToken: nil), token: nil)
        let model = AdminTasksViewModel(repository: repository, analytics: analytics)
        await model.search()
        return model
    }

    @Test("the deletion reason must be 3...500 characters after trimming")
    func reasonRule() async {
        let model = await makeModel(FakeAdminRepository())
        let cases: [(String, Bool)] = [
            ("", false), ("  ab  ", false), ("abc", true), ("  abc  ", true),
            (String(repeating: "x", count: 500), true), (String(repeating: "x", count: 501), false),
        ]
        for (reason, expected) in cases {
            model.deletionReason = reason
            #expect(model.isReasonValid == expected, "reason of \(reason.count) characters")
        }
    }

    @Test("without a valid reason nothing is deleted")
    func requiresReason() async {
        let repository = FakeAdminRepository()
        let model = await makeModel(repository)
        model.pendingDeletion = model.list.items[0]
        model.deletionReason = "no"

        await model.confirmDeletion()

        #expect(await repository.deletions.isEmpty)
        #expect(model.pendingDeletion != nil)
    }

    @Test("a confirmed deletion sends the trimmed reason, removes the row and is tracked")
    func deletes() async {
        let repository = FakeAdminRepository()
        let analytics = RecordingAnalytics()
        let model = await makeModel(repository, analytics: analytics)
        model.pendingDeletion = model.list.items[0]
        model.deletionReason = "  spam content  "

        await model.confirmDeletion()

        #expect(await repository.deletions == ["t1|spam content"])
        #expect(model.list.items.map(\.id) == ["t2"])
        #expect(model.pendingDeletion == nil)
        #expect(model.deletionReason.isEmpty)
        #expect(analytics.events == ["admin_task_deleted"])
    }

    @Test("a failed deletion keeps the row, reports the error and still resets the dialog")
    func deleteFails() async {
        let repository = FakeAdminRepository()
        let analytics = RecordingAnalytics()
        let model = await makeModel(repository, analytics: analytics)
        await repository.script(delete: .failure(.forbidden))
        model.pendingDeletion = model.list.items[0]
        model.deletionReason = "duplicate"

        await model.confirmDeletion()

        #expect(model.list.items.count == 2)
        #expect(model.error == .forbidden)
        #expect(model.pendingDeletion == nil)
        #expect(analytics.events.isEmpty)
    }
}

@Suite("Admin audit log")
@MainActor
struct AdminAuditLogViewModelTests {
    @Test("refresh replaces, the next page appends")
    func pages() async {
        let repository = FakeAdminRepository()
        await repository.script(audit: Page(items: [entry("1")], nextPageToken: "p2"), token: nil)
        await repository.script(audit: Page(items: [entry("2")], nextPageToken: nil), token: "p2")
        let model = AdminAuditLogViewModel(repository: repository)

        await model.refresh()
        await model.loadMoreIfNeeded(after: model.list.items[0])
        #expect(model.list.items.map(\.id) == ["1", "2"])

        await repository.script(audit: Page(items: [entry("9")], nextPageToken: nil), token: nil)
        await model.refresh()
        #expect(model.list.items.map(\.id) == ["9"])
    }
}

@Suite("Admin broadcast")
@MainActor
struct AdminBroadcastViewModelTests {
    @Test("an invalid draft is never sent")
    func invalidDraft() async {
        let repository = FakeAdminRepository()
        let model = AdminBroadcastViewModel(repository: repository)
        model.draft = Broadcast(title: " ")

        await model.send()

        #expect(await repository.broadcasts.isEmpty)
        #expect(model.lastRecipients == nil)
    }

    @Test("a successful broadcast reports the recipients and clears the draft")
    func sends() async {
        let repository = FakeAdminRepository()
        await repository.script(broadcast: .success(42))
        let model = AdminBroadcastViewModel(repository: repository)
        model.draft = Broadcast(title: "Maintenance", body: "Tonight", link: "/tasks")

        await model.send()

        #expect(await repository.broadcasts == [Broadcast(title: "Maintenance", body: "Tonight", link: "/tasks")])
        #expect(model.lastRecipients == 42)
        #expect(model.draft == Broadcast())
        #expect(!model.isSending)
    }

    @Test("a failed broadcast keeps the draft so it can be retried")
    func keepsDraftOnFailure() async {
        let repository = FakeAdminRepository()
        await repository.script(broadcast: .failure(.rateLimited(retryAfter: 5)))
        let model = AdminBroadcastViewModel(repository: repository)
        model.draft = Broadcast(title: "Maintenance")

        await model.send()

        #expect(model.error == .rateLimited(retryAfter: 5))
        #expect(model.draft.title == "Maintenance")
        #expect(model.lastRecipients == nil)
    }
}
