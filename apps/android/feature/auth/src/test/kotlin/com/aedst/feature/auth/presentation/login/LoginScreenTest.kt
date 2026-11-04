package com.aedst.feature.auth.presentation.login

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ApplicationProvider
import com.aedst.core.common.AedstError
import com.aedst.core.testing.assertScreenSemantics
import com.aedst.core.ui.theme.AedstTheme
import com.aedst.feature.auth.R
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import com.aedst.core.ui.R as UiR

/** JVM Compose UI test (Robolectric, English resources): the stateless [LoginScreen] against synthetic state. */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "en")
class LoginScreenTest {

    @get:Rule
    val compose = createComposeRule()

    private val context: Context = ApplicationProvider.getApplicationContext()
    private val intents = mutableListOf<LoginIntent>()

    private fun show(state: LoginState) {
        compose.setContent { AedstTheme { LoginScreen(state = state, onIntent = { intents += it }) } }
    }

    @Test
    fun `renders the title, the explanation and one primary button`() {
        show(LoginState())

        compose.onNodeWithText(context.getString(R.string.auth_login_title)).assertExists()
        compose.onNodeWithText(context.getString(R.string.auth_login_subtitle)).assertExists()
        compose.onNodeWithText(context.getString(R.string.auth_login_submit)).assertExists()
    }

    @Test
    fun `every problem state keeps the controls accessible and the screen has a heading`() {
        val states = listOf(
            "idle" to LoginState(),
            "loading" to LoginState(isLoading = true),
            "not configured" to LoginState(problem = LoginProblem.NotConfigured),
            "no browser" to LoginState(problem = LoginProblem.NoBrowser),
            "failed" to LoginState(problem = LoginProblem.Failed(AedstError.Forbidden())),
        )
        var current: LoginState by mutableStateOf(LoginState())
        compose.setContent { AedstTheme { LoginScreen(state = current, onIntent = {}) } }

        states.forEach { (name, state) ->
            current = state
            compose.waitForIdle()
            compose.assertScreenSemantics("LoginScreen $name", requireHeading = true)
        }
    }

    @Test
    fun `tapping the button starts sign-in`() {
        show(LoginState())

        compose.onNodeWithText(context.getString(R.string.auth_login_submit)).performClick()

        assertEquals(LoginIntent.SignIn, intents.single())
    }

    @Test
    fun `while loading the button keeps its name via description and is disabled`() {
        show(LoginState(isLoading = true))

        compose.onNodeWithContentDescription(context.getString(R.string.auth_login_submit)).assertIsNotEnabled()
    }

    @Test
    fun `an error kind is rendered as localized text, never the diagnostic message`() {
        show(LoginState(problem = LoginProblem.Failed(AedstError.Forbidden("raw IdP detail: user 42 locked"))))

        compose.onNodeWithText(context.getString(R.string.auth_login_failed_title)).assertExists()
        compose.onNodeWithText(context.getString(UiR.string.aedst_error_forbidden)).assertExists()
        compose.onNodeWithText("raw IdP detail", substring = true).assertDoesNotExist()
    }

    @Test
    fun `offline errors get the offline wording and the button stays usable for a retry`() {
        show(LoginState(problem = LoginProblem.Failed(AedstError.Offline())))

        compose.onNodeWithText(context.getString(UiR.string.aedst_error_offline)).assertExists()
        compose.onNodeWithText(context.getString(R.string.auth_login_submit)).assertIsEnabled()
    }

    @Test
    fun `an unconfigured build says so and disables the button`() {
        show(LoginState(problem = LoginProblem.NotConfigured))

        compose.onNodeWithText(context.getString(R.string.auth_login_not_configured)).assertExists()
        compose.onNodeWithText(context.getString(R.string.auth_login_submit)).assertIsNotEnabled()
        assertTrue(intents.isEmpty())
    }

    @Test
    fun `a missing browser is explained`() {
        show(LoginState(problem = LoginProblem.NoBrowser))

        compose.onNodeWithText(context.getString(R.string.auth_login_no_browser)).assertExists()
    }
}
