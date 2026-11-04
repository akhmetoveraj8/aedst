/// A single application-layer operation, invoked with call syntax:
/// `try await signIn(SignInRequest(...))`. Feature modules expose one
/// concrete `UseCase` per `application` command/query (see
/// `apps/server/internal/modules/*/application` and the Android
/// `domain/usecase` layer this mirrors).
public protocol UseCase<Input, Output>: Sendable {
    associatedtype Input: Sendable
    associatedtype Output: Sendable

    func callAsFunction(_ input: Input) async -> Outcome<Output>
}

/// Marker for a use case that takes no input, e.g. `RefreshSessionUseCase`.
public struct NoInput: Sendable {
    public init() {}
}
