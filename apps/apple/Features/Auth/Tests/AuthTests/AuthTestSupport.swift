import AedstCore
import Foundation
@testable import Auth

extension Session {
    static let stub = Session(
        userID: "user-1",
        accessTokenExpiresAt: .distantFuture,
        refreshTokenExpiresAt: .distantFuture
    )
}

/// `AuthRepository` double recording how it was used.
actor SpyAuthRepository: AuthRepository {
    private let signInResult: Outcome<Session>
    private(set) var signInCallCount = 0
    private(set) var lastSignInDeviceID: String?
    var storedSession: Session?

    init(signInResult: Outcome<Session>, storedSession: Session? = nil) {
        self.signInResult = signInResult
        self.storedSession = storedSession
    }

    func signIn(deviceID: String) async -> Outcome<Session> {
        signInCallCount += 1
        lastSignInDeviceID = deviceID
        return signInResult
    }

    func logout() async -> Outcome<Void> { .success(()) }

    func currentSession() async -> Session? { storedSession }
}
