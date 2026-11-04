import XCTest

/// Accessibility audits (`XCUIApplication.performAccessibilityAudit`, iOS 17+) over
/// the screens reachable without a backend. The app is launched with
/// `-aedst-ui-testing` (DEBUG builds only; `AppLaunchMode`): in-memory secure store,
/// telemetry off, always signed out.
///
/// XCTest, not Swift Testing: only XCTest can drive `XCUIApplication`.
///
/// No issue is filtered. If a known false positive ever appears, filter it inside
/// `audit(_:)` below by `issue.auditType` + element identifier and link the reason here.
///
/// Not covered: signed-in screens (task list, ...). They need a stubbed backend, which
/// the app does not have yet (repositories are concrete Connect clients).
@MainActor
final class AuditTests: XCTestCase {
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments += ["-aedst-ui-testing"]
        app.launch()
    }

    func testStartScreenPassesAccessibilityAudit() throws {
        XCTAssertTrue(app.buttons["start.signIn"].waitForExistence(timeout: 10))
        try audit(app)
    }

    func testLoginScreenPassesAccessibilityAudit() throws {
        let signIn = app.buttons["start.signIn"]
        XCTAssertTrue(signIn.waitForExistence(timeout: 10))
        signIn.tap()

        // Wait for the login screen (the browser sign-in button) to be pushed.
        XCTAssertTrue(app.buttons["login.continue"].waitForExistence(timeout: 10))
        try audit(app)
    }

    private func audit(_ app: XCUIApplication) throws {
        try app.performAccessibilityAudit()
    }
}
