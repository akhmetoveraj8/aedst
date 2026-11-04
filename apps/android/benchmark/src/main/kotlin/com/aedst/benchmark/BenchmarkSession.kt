package com.aedst.benchmark

import androidx.benchmark.macro.MacrobenchmarkScope
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.BySelector
import androidx.test.uiautomator.Direction
import androidx.test.uiautomator.UiObject2
import androidx.test.uiautomator.Until
import java.util.regex.Pattern

/** Application id of the app under test (`:app`). */
const val TARGET_PACKAGE = "com.aedst.android"

private const val UI_TIMEOUT_MS = 10_000L
private const val LOGIN_PROBE_MS = 3_000L
private const val SIGN_IN_DEADLINE_MS = 90_000L
private const val STEP_PAUSE_MS = 700L
private const val SESSION_PERSIST_MS = 1_500L
private const val FLING_ROUNDS = 3

// Element ids of ZITADEL's hosted login (zitadel/zitadel internal/api/ui/login/static/templates/login.html and
// password.html): Chrome exposes a DOM `id` as the accessibility resource id, so UiAutomator can select by it. Login
// name page: `loginName` + `submit-button`; password page: `password` + `submit-button`.
private const val LOGIN_NAME_ID = "loginName"
private const val PASSWORD_ID = "password"
private const val SUBMIT_ID = "submit-button"

// Texts are English on purpose: run the benchmark device/Chrome in English (the ZITADEL pages follow the browser
// language). The MFA/passkey "skip" buttons are matched by text because their DOM `name` is not exposed.
private val CHROME_FIRST_RUN = Pattern.compile(
    "(?i)accept & continue|use without an account|no thanks|no, thanks|got it|not now|continue without.*",
)
private val SKIP_PROMPT = Pattern.compile("(?i)skip|not now|later|cancel")
private val OTHER_ACCOUNT = Pattern.compile("(?i).*(another|other) (user|account).*")

/**
 * Text of the app's single sign-in button (`auth_login_submit`) in every language the app ships. The sign-in screen
 * carries no test tag (feature/auth is not instrumented for UiAutomator), so the visible text is the selector.
 */
private val SIGN_IN_LABELS = Pattern.compile("Continue|Продолжить|Davom etish|Идома додан|متابعة")

/**
 * A test user in the ZITADEL the benchmarked build signs in against. Supplied by the caller through instrumentation
 * arguments (the benchmark module's build file forwards `-Paedst.benchmark.email|password|submitLabel`, or the
 * `AEDST_BENCHMARK_*` environment variables); there are no defaults and nothing is committed.
 *
 * @property email the ZITADEL login name (user name or e-mail address, whatever the hosted login accepts).
 * @property submitLabel visible text of the app's sign-in button when it is not one of the shipped translations.
 *   Optional.
 */
data class BenchmarkCredentials(val email: String, val password: String, val submitLabel: String?) {
    companion object {
        private const val EMAIL = "aedst.benchmark.email"
        private const val PASSWORD = "aedst.benchmark.password"
        private const val SUBMIT_LABEL = "aedst.benchmark.submitLabel"

        /** The credentials passed to this instrumentation run, or null when the signed-in journeys are not enabled. */
        fun fromArguments(): BenchmarkCredentials? {
            val arguments = InstrumentationRegistry.getArguments()
            val email = arguments.getString(EMAIL)?.takeIf(String::isNotBlank)
            val password = arguments.getString(PASSWORD)?.takeIf(String::isNotBlank)
            return if (email != null && password != null) {
                BenchmarkCredentials(email, password, arguments.getString(SUBMIT_LABEL)?.takeIf(String::isNotBlank))
            } else {
                null
            }
        }
    }
}

/** Reason shown when a signed-in benchmark is skipped. */
const val SIGNED_IN_SKIP_MESSAGE =
    "Signed-in benchmarks need a ZITADEL test user (no MFA, no forced password change): pass " +
        "-Paedst.benchmark.email=<login name>, -Paedst.benchmark.password and build the app with " +
        "-Paedst.oidc.issuer / -Paedst.oidc.clientId / -Paedst.oidc.projectId; see apps/android/README.md."

private fun signInButton(credentials: BenchmarkCredentials?): BySelector {
    val label = credentials?.submitLabel?.let { Pattern.compile(Pattern.quote(it)) } ?: SIGN_IN_LABELS
    return By.pkg(TARGET_PACKAGE).text(label)
}

/**
 * Waits for the app's signed-out screen (its sign-in button). Returns false when the app is signed in. Any
 * `MacrobenchmarkScope.startActivityAndWait()` must have run before.
 */
fun MacrobenchmarkScope.waitForLoginScreen(timeoutMs: Long = UI_TIMEOUT_MS, submitLabel: String? = null): Boolean =
    device.wait(Until.hasObject(signInButton(BenchmarkCredentials("", "", submitLabel))), timeoutMs)

/**
 * Signs in through the real UI unless a session already exists: taps the app's sign-in button, which opens
 * ZITADEL's hosted login in a Chrome Custom Tab, then drives that page (Chrome first-run screens, account chooser,
 * login name, password, optional "skip MFA / passkey" prompts) until the redirect brings the app back to the
 * signed-in screen. Every step has a deadline and fails with the step that was last seen.
 *
 * Requires: Chrome as the default browser (first-run screens are dismissed), device language English, and a test
 * user without MFA and without a required password change. The hosted-login ids come from ZITADEL's login templates
 * (see the constants above); text selectors are UNVERIFIED against a live instance.
 */
fun MacrobenchmarkScope.signInIfNeeded(credentials: BenchmarkCredentials) {
    if (!waitForLoginScreen(LOGIN_PROBE_MS, credentials.submitLabel)) return
    val appSignIn = signInButton(credentials)
    checkNotNull(device.findObject(appSignIn)) { "App sign-in button not found" }.click()

    val deadline = System.currentTimeMillis() + SIGN_IN_DEADLINE_MS
    var lastStep = "waiting for the browser to open"
    while (System.currentTimeMillis() < deadline) {
        val password = device.findObject(By.res(PASSWORD_ID))
        val loginName = device.findObject(By.res(LOGIN_NAME_ID))
        val step = when {
            // Back in the app and the sign-in button is gone: the code exchange succeeded.
            device.hasObject(By.pkg(TARGET_PACKAGE)) && !device.hasObject(appSignIn) -> return
            // The password page also carries the (hidden) login name, so it is checked first.
            password != null -> submitHosted(password, credentials.password, "password")
            loginName != null -> submitHosted(loginName, credentials.email, "login name")
            clickIfPresent(By.text(OTHER_ACCOUNT)) -> "account chooser (use another account)"
            clickIfPresent(By.text(CHROME_FIRST_RUN)) -> "Chrome first-run screen"
            clickIfPresent(By.text(SKIP_PROMPT)) -> "skip MFA / passkey prompt"
            else -> null
        }
        if (step != null) lastStep = step
        Thread.sleep(STEP_PAUSE_MS)
    }
    error(
        "Sign-in did not complete within ${SIGN_IN_DEADLINE_MS / 1000}s; last step: $lastStep. Check the test user " +
            "(no MFA, no password change), the issuer/clientId build properties and that Chrome is the default browser.",
    )
}

private fun MacrobenchmarkScope.submitHosted(field: UiObject2, value: String, name: String): String {
    field.text = value
    device.findObject(By.res(SUBMIT_ID))?.click() ?: device.pressEnter()
    device.waitForIdle()
    return name
}

private fun MacrobenchmarkScope.clickIfPresent(selector: BySelector): Boolean {
    val target = device.findObject(selector) ?: return false
    target.click()
    return true
}

/** Gives the app time to persist the session, then kills it so the next launch is a genuine cold start. */
fun MacrobenchmarkScope.persistSessionAndKill() {
    Thread.sleep(SESSION_PERSIST_MS)
    killProcess()
}

/** Flings the first scrollable list (the task list) down and back up. Needs enough rows on the account to scroll. */
fun MacrobenchmarkScope.flingTaskList() {
    val list = device.wait(Until.findObject(By.pkg(TARGET_PACKAGE).scrollable(true)), UI_TIMEOUT_MS)
        ?: error("No scrollable list found: the test account needs enough tasks to fill more than one screen")
    list.setGestureMargin(device.displayWidth / 5)
    repeat(FLING_ROUNDS) {
        list.fling(Direction.DOWN)
        device.waitForIdle()
    }
    repeat(FLING_ROUNDS) {
        list.fling(Direction.UP)
        device.waitForIdle()
    }
}
