package com.aedst.feature.auth.presentation.login

import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.junit4.accessibility.enableAccessibilityChecks
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.aedst.core.common.AedstError
import com.aedst.core.ui.theme.AedstTheme
import com.aedst.feature.auth.R
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Instrumented run of the sign-in screen with the Accessibility Test Framework (ATF) checks switched on: every
 * `perform*`/assert also validates the whole hierarchy for touch-target size, contrast, missing labels, duplicate
 * clickable bounds, etc., and fails the test on a violation. Run:
 * `./gradlew :feature:auth:connectedDebugAndroidTest`
 * (needs an emulator/device; CI runs it on the emulator lane). Texts come from the string resources (`getString`), so
 * the test follows the device locale and a reworded button does not break it.
 */
@OptIn(ExperimentalTestApi::class)
@RunWith(AndroidJUnit4::class)
class LoginScreenAccessibilityTest {

    @get:Rule
    val compose = createComposeRule()

    @Before
    fun enableChecks() {
        compose.enableAccessibilityChecks()
    }

    private fun string(id: Int) = InstrumentationRegistry.getInstrumentation().targetContext.getString(id)

    private fun show(state: LoginState) {
        compose.setContent { AedstTheme { LoginScreen(state = state, onIntent = {}) } }
    }

    @Test
    fun idleScreen_passesAccessibilityChecks() {
        show(LoginState())

        compose.onNodeWithText(string(R.string.auth_login_submit)).performClick()
    }

    @Test
    fun failedSignIn_passesAccessibilityChecks() {
        show(LoginState(problem = LoginProblem.Failed(AedstError.Forbidden())))

        compose.onNodeWithText("Continue").performClick()
    }

    @Test
    fun notConfigured_passesAccessibilityChecks() {
        show(LoginState(problem = LoginProblem.NotConfigured))

        compose.onNodeWithText(string(R.string.auth_login_not_configured)).assertExists()
    }

    @Test
    fun loadingState_passesAccessibilityChecks() {
        show(LoginState(isLoading = true))

        compose.onNodeWithContentDescription(string(R.string.auth_login_submit)).assertExists()
    }
}
