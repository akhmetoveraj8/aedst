package com.aedst.feature.tasks.presentation.create

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ApplicationProvider
import com.aedst.core.testing.assertScreenSemantics
import com.aedst.core.ui.theme.AedstTheme
import com.aedst.feature.tasks.R
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** [TaskCreateScreen] against synthetic state (Robolectric, English resources; JUnit 4 runner). */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "en")
class TaskCreateScreenTest {

    @get:Rule
    val compose = createComposeRule()

    private val context: Context = ApplicationProvider.getApplicationContext()

    @Test
    fun `is accessible, flags a missing title and confirms a form saved offline`() {
        val intents = mutableListOf<TaskCreateIntent>()
        var state by mutableStateOf(TaskCreateState(title = "Write the quarterly report"))
        compose.setContent {
            AedstTheme { TaskCreateScreen(state = state, onIntent = { intents += it }, onBack = {}) }
        }
        compose.assertScreenSemantics("TaskCreateScreen idle")
        compose.onNodeWithText(context.getString(R.string.tasks_save)).performClick()
        assertEquals(listOf<TaskCreateIntent>(TaskCreateIntent.Submit), intents)

        state = TaskCreateState(isTitleInvalid = true)
        compose.waitForIdle()
        compose.onNodeWithText(context.getString(R.string.tasks_field_title_required)).assertExists()
        compose.assertScreenSemantics("TaskCreateScreen invalid title")

        state = TaskCreateState(isQueued = true)
        compose.waitForIdle()
        compose.onNodeWithText(context.getString(R.string.tasks_pending_sync)).assertExists()
        compose.assertScreenSemantics("TaskCreateScreen queued")
    }
}
