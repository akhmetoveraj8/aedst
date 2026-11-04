package com.aedst.feature.auth.presentation.devicelogin

import android.content.Context
import androidx.compose.foundation.clickable
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ApplicationProvider
import com.aedst.core.common.AedstError
import com.aedst.core.testing.assertScreenSemantics
import com.aedst.core.ui.theme.AedstTheme
import com.aedst.feature.auth.R
import com.aedst.feature.auth.navigation.AuthActionButton
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The TV sign-in screen against synthetic state (Robolectric, English resources; JUnit 4 runner). The window is a TV
 * (960x540dp is too short for the large code and the instructions, a click below the window would miss the button).
 */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "en-w1000dp-h1400dp")
class DeviceLoginScreenTest {

    @get:Rule
    val compose = createComposeRule()

    private val context: Context = ApplicationProvider.getApplicationContext()
    private val intents = mutableListOf<DeviceLoginIntent>()

    private val waiting = DeviceLoginState.WaitingForUser(
        userCode = "KWP4-9XZ2",
        verificationUri = "https://id.example.com/device",
        verificationUriComplete = "https://id.example.com/device?c=KWP4-9XZ2",
        remainingSeconds = 540,
    )

    private fun show(state: DeviceLoginState, actionButton: AuthActionButton? = null) {
        compose.setContent {
            AedstTheme {
                DeviceLoginScreen(state = state, onIntent = { intents += it }, actionButton = actionButton)
            }
        }
    }

    @Test
    fun `every state keeps its controls accessible and has a heading`() {
        var current: DeviceLoginState by mutableStateOf(DeviceLoginState.Requesting)
        compose.setContent { AedstTheme { DeviceLoginScreen(state = current, onIntent = {}) } }

        val states = listOf(
            "requesting" to DeviceLoginState.Requesting,
            "waiting" to waiting,
            "denied" to DeviceLoginState.Failed(DeviceLoginProblem.Denied),
            "offline" to DeviceLoginState.Failed(DeviceLoginProblem.Failed(AedstError.Offline())),
            "not configured" to DeviceLoginState.Failed(DeviceLoginProblem.NotConfigured),
        )
        states.forEach { (name, state) ->
            current = state
            compose.waitForIdle()
            compose.assertScreenSemantics("DeviceLoginScreen $name", requireHeading = true)
        }
    }

    @Test
    fun `the code and the address are on screen while waiting`() {
        show(waiting)

        compose.onNodeWithText("KWP4-9XZ2").assertExists()
        compose.onNodeWithText("https://id.example.com/device").assertExists()
    }

    @Test
    fun `the new-code button asks for a new code`() {
        show(waiting)

        compose.onNodeWithText(context.getString(R.string.auth_device_new_code)).performClick()

        assertEquals(DeviceLoginIntent.GetNewCode, intents.single())
    }

    @Test
    fun `app-tv can replace the button with its own D-pad button`() {
        show(waiting) { text, onClick, modifier, _, _ ->
            Text("tv-button:$text", modifier = modifier.clickable(onClick = onClick))
        }

        compose.onNodeWithText("tv-button:" + context.getString(R.string.auth_device_new_code)).assertExists()
        compose.onNodeWithText(context.getString(R.string.auth_device_new_code)).assertDoesNotExist()
    }
}
