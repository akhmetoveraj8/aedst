package com.aedst.core.ui.tv

import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Text
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsFocused
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performKeyInput
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.pressKey
import com.aedst.core.ui.theme.AedstTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Robolectric Compose tests (JUnit 4 runner, see libs.versions.toml) of the 10-foot-UI wrappers. */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "w960dp-h540dp")
class TvComponentsTest {

    @get:Rule
    val compose = createComposeRule()

    @Test
    fun `the primary button shows its label and reports clicks`() {
        var clicks = 0
        compose.setContent { AedstTheme { TvPrimaryButton(text = "Continue", onClick = { clicks++ }) } }

        // TV surfaces are activated by the D-pad centre key on the focused element, not by a touch click.
        compose.onNodeWithText("Continue").assertIsDisplayed().assertIsEnabled()
            .performSemanticsAction(SemanticsActions.RequestFocus)
        compose.onNodeWithText("Continue").performKeyInput { pressKey(Key.DirectionCenter) }

        assertEquals(1, clicks)
    }

    @Test
    fun `a disabled primary button is not clickable`() {
        var clicks = 0
        compose.setContent {
            AedstTheme { TvPrimaryButton(text = "Continue", onClick = { clicks++ }, enabled = false) }
        }

        compose.onNodeWithText("Continue").assertIsNotEnabled()

        assertEquals(0, clicks)
    }

    @Test
    fun `the top bar shows the title and its actions`() {
        compose.setContent {
            AedstTheme { TvTopAppBar(title = "AEDST", actions = { Text("Settings") }) }
        }

        compose.onNodeWithText("AEDST").assertIsDisplayed()
        compose.onNodeWithText("Settings").assertIsDisplayed()
    }

    @Test
    fun `the lazy column renders its items`() {
        compose.setContent {
            AedstTheme {
                TvLazyColumn { items(listOf("first", "second")) { Text(it) } }
            }
        }

        compose.onNodeWithText("first").assertIsDisplayed()
        compose.onNodeWithText("second").assertIsDisplayed()
    }

    @Test
    fun `the lazy row renders its items`() {
        compose.setContent {
            AedstTheme {
                TvLazyRow { items(listOf("left", "right")) { Text(it) } }
            }
        }

        compose.onNodeWithText("left").assertIsDisplayed()
        compose.onNodeWithText("right").assertIsDisplayed()
    }

    @Test
    fun `the upgrade screen focuses its only button so one D-pad press starts the update`() {
        var updates = 0
        compose.setContent { AedstTheme { TvUpgradeRequiredScreen(onUpdate = { updates++ }) } }
        compose.waitForIdle()

        compose.onNodeWithText("Update required").assertIsDisplayed()
        compose.onNodeWithText("Update on Google Play").assertIsFocused()
        compose.onNodeWithText("Update on Google Play").performKeyInput { pressKey(Key.DirectionCenter) }

        assertEquals(1, updates)
    }
}
