import AedstCore
import Foundation

/// Interactive browser sign-in (Authorization Code + PKCE). There are no credentials
/// to validate here: the identity provider owns them. `LoginViewModel` depends on this,
/// not on `AuthRepository` directly.
public struct SignInUseCase: UseCase {
    private let repository: AuthRepository

    public init(repository: AuthRepository) {
        self.repository = repository
    }

    public func callAsFunction(_ input: SignInInput) async -> Outcome<Session> {
        await repository.signIn(deviceID: input.deviceID)
    }
}

public struct SignInInput: Sendable {
    public let deviceID: String

    public init(deviceID: String) {
        self.deviceID = deviceID
    }
}

public struct LogoutUseCase: UseCase {
    private let repository: AuthRepository

    public init(repository: AuthRepository) {
        self.repository = repository
    }

    public func callAsFunction(_ input: NoInput) async -> Outcome<Void> {
        await repository.logout()
    }
}

/// Restores the persisted session at launch (no network call).
public struct RestoreSessionUseCase: UseCase {
    private let repository: AuthRepository

    public init(repository: AuthRepository) {
        self.repository = repository
    }

    public func callAsFunction(_ input: NoInput) async -> Outcome<Session?> {
        .success(await repository.currentSession())
    }
}
