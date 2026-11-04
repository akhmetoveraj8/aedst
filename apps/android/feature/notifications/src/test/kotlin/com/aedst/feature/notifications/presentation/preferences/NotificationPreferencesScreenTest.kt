package com.aedst.feature.notifications.presentation.preferences

import android.content.Context
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ApplicationProvider
import com.aedst.core.testing.assertScreenSemantics
import com.aedst.core.ui.theme.AedstTheme
import com.aedst.feature.notifications.R
import com.aedst.feature.notifications.allEnabled
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** [NotificationPreferencesScreen] against synthetic state (Robolectric, English resources; JUnit 4 runner). */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "en")
class NotificationPreferencesScreenTest {

    @get:Rule
    val compose = createComposeRule()

    private val context: Context = ApplicationProvider.getApplicationContext()
    private val intents = mutableListOf<NotificationPreferencesIntent>()

    private fun show(state: NotificationPreferencesState) {
        compose.setContent {
            AedstTheme { NotificationPreferencesScreen(state = state, onIntent = { intents += it }, onBack = {}) }
        }
    }

    @Test
    fun `is accessible with the switches shown and while the preferences load`() {
        show(NotificationPreferencesState(preferences = allEnabled))

        compose.assertScreenSemantics("NotificationPreferencesScreen loaded")
    }

    @Test
    fun `flipping a switch sends an update that changes only that preference`() {
        show(NotificationPreferencesState(preferences = allEnabled))

        compose.onNodeWithText(context.getString(R.string.notifications_pref_push)).performClick()

        val update = intents.single() as NotificationPreferencesIntent.Update
        val changed = update.transform(allEnabled)
        assertFalse(changed.pushEnabled)
        assertEquals(allEnabled.copy(pushEnabled = false), changed)
    }

    @Test
    fun `while loading there is nothing to flip`() {
        show(NotificationPreferencesState(preferences = null))

        compose.onNodeWithText(context.getString(R.string.notifications_pref_push)).assertDoesNotExist()
        compose.assertScreenSemantics("NotificationPreferencesScreen loading")
    }
}
