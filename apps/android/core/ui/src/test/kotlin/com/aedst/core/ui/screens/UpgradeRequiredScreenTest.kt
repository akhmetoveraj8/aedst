package com.aedst.core.ui.screens

import android.content.Context
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ApplicationProvider
import com.aedst.core.testing.assertScreenSemantics
import com.aedst.core.ui.R
import com.aedst.core.ui.theme.AedstTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** The blocking forced-upgrade screen (Robolectric, English resources; JUnit 4 runner). */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "en")
class UpgradeRequiredScreenTest {

    @get:Rule
    val compose = createComposeRule()

    private val context: Context = ApplicationProvider.getApplicationContext()

    @Test
    fun `explains why and offers the single update action, accessibly`() {
        compose.setContent { AedstTheme { UpgradeRequiredScreen() } }

        compose.onNodeWithText(context.getString(R.string.aedst_upgrade_title)).assertExists()
        compose.onNodeWithText(context.getString(R.string.aedst_upgrade_body)).assertExists()
        compose.assertScreenSemantics("UpgradeRequiredScreen")
    }

    @Test
    fun `the update button reports the tap before it opens the store`() {
        var updates = 0
        compose.setContent { AedstTheme { UpgradeRequiredScreen(onUpdate = { updates++ }) } }

        compose.onNodeWithText(context.getString(R.string.aedst_upgrade_action)).performClick()

        assertEquals(1, updates)
    }
}
