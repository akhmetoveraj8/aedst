package com.aedst.core.ui.tv

import androidx.compose.foundation.lazy.items
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertHeightIsAtLeast
import androidx.compose.ui.test.assertIsFocused
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performKeyInput
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.pressKey
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import com.aedst.core.testing.assertScreenSemantics
import com.aedst.core.ui.theme.AedstTheme
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** D-pad, RTL and screen-reader behaviour of the TV wrappers. */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "w960dp-h540dp")
class TvAccessibilityTest {

    @get:Rule
    val compose = createComposeRule()

    @Test
    fun `the primary button is at least 48dp tall and labelled`() {
        compose.setContent { AedstTheme { TvPrimaryButton(text = "Continue", onClick = {}) } }

        compose.onNodeWithText("Continue").assertHeightIsAtLeast(48.dp)
        compose.assertScreenSemantics("TvPrimaryButton")
    }

    @Test
    fun `the top bar title is a heading`() {
        compose.setContent { AedstTheme { TvTopAppBar(title = "AEDST") } }

        compose.onNodeWithText("AEDST").assert(SemanticsMatcher.keyIsDefined(SemanticsProperties.Heading))
    }

    @Test
    fun `the upgrade screen is accessible`() {
        compose.setContent { AedstTheme { TvUpgradeRequiredScreen() } }

        compose.assertScreenSemantics("TvUpgradeRequiredScreen", requireHeading = true)
    }

    private fun rowOfButtons(direction: LayoutDirection) {
        compose.setContent {
            CompositionLocalProvider(LocalLayoutDirection provides direction) {
                AedstTheme {
                    TvLazyRow { items(listOf("One", "Two", "Three")) { TvPrimaryButton(text = it, onClick = {}) } }
                }
            }
        }
        compose.onNodeWithText("One").performSemanticsAction(SemanticsActions.RequestFocus)
        compose.onNodeWithText("One").assertIsFocused()
    }

    @Test
    fun `D-pad right moves to the next item in a left-to-right row`() {
        rowOfButtons(LayoutDirection.Ltr)

        compose.onNodeWithText("One").performKeyInput { pressKey(Key.DirectionRight) }

        compose.onNodeWithText("Two").assertIsFocused()
    }

    @Test
    fun `D-pad left moves to the next item in a right-to-left row`() {
        rowOfButtons(LayoutDirection.Rtl)

        compose.onNodeWithText("One").performKeyInput { pressKey(Key.DirectionLeft) }

        compose.onNodeWithText("Two").assertIsFocused()
    }
}
