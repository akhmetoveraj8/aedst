import Foundation
import Testing
@testable import AedstCore

@Suite("AedstError")
struct AedstErrorTests {
    @Test("unavailable, offline, timeout and rateLimited are retryable")
    func retryableCases() {
        #expect(AedstError.unavailable(reason: "timeout").isRetryable)
        #expect(AedstError.rateLimited(retryAfter: 1).isRetryable)
        #expect(AedstError.offline.isRetryable)
        #expect(AedstError.timeout.isRetryable)
    }

    @Test("client, storage and unknown errors are not retryable")
    func nonRetryableCases() {
        #expect(!AedstError.unauthenticated.isRetryable)
        #expect(!AedstError.notFound.isRetryable)
        #expect(!AedstError.invalidInput(fields: ["email"]).isRetryable)
        #expect(!AedstError.storage(reason: "x").isRetryable)
        #expect(!AedstError.unknown(reason: "x").isRetryable)
        #expect(!AedstError.unsupported.isRetryable)
        #expect(!AedstError.cancelled.isRetryable)
        #expect(!AedstError.upgradeRequired.isRetryable)
    }

    @Test("Outcome exposes value and error")
    func outcomeAccessors() {
        let success: Outcome<Int> = .success(1)
        let failure: Outcome<Int> = .failure(.unauthenticated)

        #expect(success.value == 1)
        #expect(success.error == nil)
        #expect(failure.value == nil)
        #expect(failure.error == .unauthenticated)
    }

    @Test("user-facing text is localized and never leaks the technical reason")
    func errorDescriptionHidesTechnicalDetail() {
        let secret = "SELECT * FROM users; stacktrace 0xdeadbeef"
        let all: [AedstError] = [
            .unavailable(reason: secret), .offline, .timeout, .unauthenticated, .forbidden, .conflict, .notFound, .invalidInput(fields: [secret]),
            .rateLimited(retryAfter: 3), .decoding(reason: secret), .storage(reason: secret), .unknown(reason: secret),
            .unsupported, .cancelled, .upgradeRequired,
        ]
        for error in all {
            let text = error.errorDescription
            #expect(text != nil)
            #expect(text?.isEmpty == false)
            #expect(text?.contains(secret) == false)
            #expect(text?.hasPrefix("error") == false, "missing localization key for \(error)")
        }
    }

    @Test("technicalDescription keeps the detail for logs")
    func technicalDescriptionKeepsDetail() {
        #expect(AedstError.unavailable(reason: "boom").technicalDescription.contains("boom"))
    }

    @Test("analytics categories are PII-free constants")
    func analyticsCategory() {
        #expect(AedstError.unavailable(reason: "user@example.com").analyticsCategory == "unavailable")
        #expect(AedstError.storage(reason: "x").analyticsCategory == "storage")
        #expect(AedstError.upgradeRequired.analyticsCategory == "upgradeRequired")
    }
}
