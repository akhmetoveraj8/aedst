package com.aedst.feature.tasks.presentation.detail

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
import com.aedst.feature.tasks.domain.TaskStatus
import com.aedst.feature.tasks.domainTask
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** [TaskDetailScreen] against synthetic state (Robolectric, English resources; JUnit 4 runner). */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "en")
class TaskDetailScreenTest {

    @get:Rule
    val compose = createComposeRule()

    private val context: Context = ApplicationProvider.getApplicationContext()

    @Test
    fun `is accessible, completes on tap, and a completion queued offline says so`() {
        val intents = mutableListOf<TaskDetailIntent>()
        var state by mutableStateOf(TaskDetailState(task = domainTask("1"), isLoading = false))
        compose.setContent {
            AedstTheme {
                TaskDetailScreen(
                    state = state,
                    uploads = emptyList(),
                    onIntent = { intents += it },
                    onBack = {},
                    onOpenMedia = {},
                )
            }
        }
        compose.assertScreenSemantics("TaskDetailScreen open")
        compose.onNodeWithText(context.getString(R.string.tasks_complete)).performClick()
        assertEquals(listOf<TaskDetailIntent>(TaskDetailIntent.ToggleDone), intents)

        state = TaskDetailState(task = domainTask("1", TaskStatus.DONE), isLoading = false, isPendingSync = true)
        compose.waitForIdle()
        compose.onNodeWithText(context.getString(R.string.tasks_pending_sync_title)).assertExists()
        compose.assertScreenSemantics("TaskDetailScreen pending sync")
    }

    @Test
    fun `a task that is still loading shows no controls that could act on nothing`() {
        compose.setContent {
            AedstTheme {
                TaskDetailScreen(
                    state = TaskDetailState(isLoading = true),
                    uploads = emptyList(),
                    onIntent = {},
                    onBack = {},
                    onOpenMedia = {},
                )
            }
        }

        compose.onNodeWithText(context.getString(R.string.tasks_complete)).assertDoesNotExist()
        compose.assertScreenSemantics("TaskDetailScreen loading")
    }
}
