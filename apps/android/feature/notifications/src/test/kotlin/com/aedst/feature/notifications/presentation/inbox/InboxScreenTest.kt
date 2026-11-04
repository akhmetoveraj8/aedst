package com.aedst.feature.notifications.presentation.inbox

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ApplicationProvider
import com.aedst.core.testing.assertScreenSemantics
import com.aedst.core.ui.theme.AedstTheme
import com.aedst.feature.notifications.R
import com.aedst.feature.notifications.inboxNotification
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** [InboxScreen] against synthetic state (Robolectric, English resources; JUnit 4 runner). */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "en")
class InboxScreenTest {

    @get:Rule
    val compose = createComposeRule()

    private val context: Context = ApplicationProvider.getApplicationContext()

    @Test
    fun `is accessible while loading, empty and with notifications`() {
        var state by mutableStateOf(InboxState())
        compose.setContent {
            AedstTheme { InboxScreen(state = state, onIntent = {}, onOpen = {}, onOpenPreferences = {}) }
        }
        compose.assertScreenSemantics("InboxScreen loading")

        state = InboxState(isLoading = false)
        compose.waitForIdle()
        compose.onNodeWithText(context.getString(R.string.notifications_empty)).assertExists()
        compose.assertScreenSemantics("InboxScreen empty")

        state = InboxState(
            notifications = listOf(inboxNotification("1"), inboxNotification("2")),
            nextPageToken = "p2",
            isLoading = false,
        )
        compose.waitForIdle()
        compose.assertScreenSemantics("InboxScreen notifications")
    }

    @Test
    fun `a row opens, mark-all-read and load-more send their intents`() {
        val intents = mutableListOf<InboxIntent>()
        val opened = mutableListOf<String>()
        compose.setContent {
            AedstTheme {
                InboxScreen(
                    state = InboxState(
                        notifications = listOf(inboxNotification("1")),
                        nextPageToken = "p2",
                        isLoading = false,
                    ),
                    onIntent = { intents += it },
                    onOpen = { opened += it.id },
                    onOpenPreferences = {},
                )
            }
        }

        compose.onNodeWithText("Title 1").performClick()
        compose.onNodeWithContentDescription(context.getString(R.string.notifications_mark_all_read)).performClick()
        compose.onNodeWithText(context.getString(R.string.notifications_load_more)).performClick()

        assertEquals(listOf("1"), opened)
        assertEquals(listOf(InboxIntent.MarkAllRead, InboxIntent.LoadMore), intents)
    }
}
