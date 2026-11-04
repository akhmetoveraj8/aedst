package com.aedst.core.ui.components

import android.content.Context
import androidx.compose.material3.Surface
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.test.core.app.ApplicationProvider
import com.aedst.core.ui.R
import com.aedst.core.ui.theme.AedstTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/** Semantics-level accessibility checks for the design-system components that carry non-visual text. */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "en")
class AccessibilityTest {

    @get:Rule
    val compose = createComposeRule()

    private val context: Context = ApplicationProvider.getApplicationContext()

    private fun show(content: @androidx.compose.runtime.Composable () -> Unit) {
        compose.setContent { AedstTheme { Surface { content() } } }
    }

    @Test
    fun `offline banner is hidden while online`() {
        show { AedstOfflineBanner(isOffline = false) }

        compose.onNodeWithText(context.getString(R.string.aedst_offline_banner)).assertDoesNotExist()
    }

    @Test
    fun `offline banner is a polite live region so TalkBack announces it`() {
        show { AedstOfflineBanner(isOffline = true) }

        // The live region is on the banner container; its descendant Text is what gets announced.
        compose.onNode(
            SemanticsMatcher.expectValue(SemanticsProperties.LiveRegion, LiveRegionMode.Polite),
        ).assertExists()
        compose.onNodeWithText(context.getString(R.string.aedst_offline_banner)).assertExists()
    }

    @Test
    fun `avatar description includes the initials`() {
        show { AedstAvatar(initials = "ab") }

        compose.onNodeWithContentDescription(context.getString(R.string.aedst_a11y_avatar_named, "AB")).assertExists()
    }

    @Test
    fun `descriptions follow the device locale`() {
        val english = context.getString(R.string.aedst_a11y_loading)
        RuntimeEnvironment.setQualifiers("+ru")

        val russian = context.getString(R.string.aedst_a11y_loading)

        assertEquals("Loading", english)
        assertEquals("Загрузка", russian)
    }
}
