import AedstCore
import Foundation

/// Validates and creates a task: the one place the create rules live on the client (the server enforces the same
/// limits via Protovalidate; Android and Desktop have the same use case with the same numbers: title 1..200,
/// description at most 4000, both measured in Unicode code points).
public struct CreateTaskUseCase: UseCase {
    /// Same limit as `CreateTaskRequest.title` (max_len 200).
    public static let maxTitleLength = 200
    /// Same limit as `CreateTaskRequest.description` (max_len 4000).
    public static let maxDescriptionLength = 4000

    /// The field that failed validation; its raw value is the name reported in `AedstError.invalidInput(fields:)`.
    public enum Rejection: String, Error, Equatable, Sendable {
        case title
        case description
    }

    private let repository: any TaskRepository

    /// Uses `repository`.
    public init(repository: any TaskRepository) {
        self.repository = repository
    }

    public func callAsFunction(_ input: NewTask) async -> Outcome<TaskItem> {
        await callAsFunction(input, idempotencyKey: nil)
    }

    /// `idempotencyKey` is the draft id: the same value the offline queue uses, so one intent is one write.
    public func callAsFunction(_ input: NewTask, idempotencyKey: String?) async -> Outcome<TaskItem> {
        switch Self.validated(input) {
        case .success(let task):
            return await repository.create(task, idempotencyKey: idempotencyKey)
        case .failure(let rejection):
            return .failure(.invalidInput(fields: [rejection.rawValue]))
        }
    }

    /// The input with trimmed title and description, or the field that is blank (title) or too long. Shared with
    /// the offline path, which must queue only what the server would accept.
    public static func validated(_ input: NewTask) -> Result<NewTask, Rejection> {
        let title = input.title.trimmingCharacters(in: .whitespacesAndNewlines)
        let details = input.details.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty, title.unicodeScalars.count <= maxTitleLength else { return .failure(.title) }
        guard details.unicodeScalars.count <= maxDescriptionLength else { return .failure(.description) }
        var task = input
        task.title = title
        task.details = details
        return .success(task)
    }

    /// `validated(_:)` without the reason: `nil` when the input would be rejected.
    public static func normalized(_ input: NewTask) -> NewTask? {
        try? validated(input).get()
    }
}
