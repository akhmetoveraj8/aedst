package com.aedst.feature.tasks.presentation.list

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
import com.aedst.feature.tasks.R
import com.aedst.feature.tasks.domainTask
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** [TaskListScreen] against synthetic state (Robolectric, English resources; JUnit 4 runner). */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "en")
class TaskListScreenTest {

    @get:Rule
    val compose = createComposeRule()

    private val context: Context = ApplicationProvider.getApplicationContext()

    @Test
    fun `is accessible while loading, empty and with tasks, and the FAB creates a task`() {
        var state by mutableStateOf(TaskListState())
        var created = 0
        compose.setContent {
            AedstTheme {
                TaskListScreen(state = state, onIntent = {}, onOpenTask = {}, onCreateTask = { created++ })
            }
        }
        compose.assertScreenSemantics("TaskListScreen loading")

        state = TaskListState(isLoading = false)
        compose.waitForIdle()
        compose.onNodeWithText(context.getString(R.string.tasks_empty)).assertExists()
        compose.assertScreenSemantics("TaskListScreen empty")

        state = TaskListState(tasks = listOf(domainTask("1"), domainTask("2")), totalCount = 2, isLoading = false)
        compose.waitForIdle()
        compose.assertScreenSemantics("TaskListScreen tasks")

        compose.onNodeWithContentDescription(context.getString(R.string.tasks_create)).performClick()
        assertEquals(1, created)
    }

    @Test
    fun `a tapped task is handed to navigation`() {
        val opened = mutableListOf<String>()
        compose.setContent {
            AedstTheme {
                TaskListScreen(
                    state = TaskListState(tasks = listOf(domainTask("1", title = "Write report")), isLoading = false),
                    onIntent = {},
                    onOpenTask = { opened += it },
                    onCreateTask = {},
                )
            }
        }

        compose.onNodeWithText("Write report").performClick()

        assertEquals(listOf("1"), opened)
    }
}
