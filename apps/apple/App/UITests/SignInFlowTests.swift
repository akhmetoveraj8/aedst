import XCTest

/// User flow over the screens reachable without a backend, launched with `-aedst-ui-testing`
/// (DEBUG builds only; `AppLaunchMode`): in-memory secure store, telemetry off, always signed
/// out, and the placeholder identity provider (`OIDCConfiguration.unconfigured`, an `.invalid` host).
///
/// Flow: start screen -> Sign in -> the login screen offers a single "continue in browser" button
/// (no credential fields) -> tapping it fails at discovery (the placeholder host cannot resolve),
/// shows an inline error (`login.error`) and leaves the user on the screen. The assertion is only
/// that *an* error appears, not which sentence it shows. The system browser sheet is never reached.
///
/// UNVERIFIED: written without Xcode; never run.
///
/// XCTest, not Swift Testing: only XCTest can drive `XCUIApplication`.
@MainActor
final class SignInFlowTests: XCTestCase {
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments += ["-aedst-ui-testing"]
        app.launch()
    }

    func testLoginOffersOnlyBrowserSignInAndAFailedAttemptShowsAnError() throws {
        let signIn = app.buttons["start.signIn"]
        XCTAssertTrue(signIn.waitForExistence(timeout: 10))
        signIn.tap()

        let continueButton = app.buttons["login.continue"]
        XCTAssertTrue(continueButton.waitForExistence(timeout: 10))
        XCTAssertFalse(app.textFields.firstMatch.exists, "no email field")
        XCTAssertFalse(app.secureTextFields.firstMatch.exists, "no password field")

        continueButton.tap()

        XCTAssertTrue(app.staticTexts["login.error"].waitForExistence(timeout: 20))
        XCTAssertTrue(continueButton.exists, "still on the login screen")
    }
}
