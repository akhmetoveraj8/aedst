package com.aedst.feature.tasks.presentation.list

import android.content.Context
import androidx.compose.material3.Text
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ApplicationProvider
import com.aedst.core.testing.assertScreenSemantics
import com.aedst.core.ui.theme.AedstTheme
import com.aedst.feature.tasks.R
import com.aedst.feature.tasks.domain.TaskPriority
import com.aedst.feature.tasks.domain.TaskStatus
import com.aedst.feature.tasks.domainTask
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The tasks screen at the three window width classes (Robolectric qualifiers; JUnit 4 runner, see
 * libs.versions.toml). Compact and medium show the list alone and hand a tap to navigation; expanded shows the detail
 * pane beside the list and swaps the task in place.
 */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "en")
class TaskListDetailScreenTest {

    @get:Rule
    val compose = createComposeRule()

    private val context: Context = ApplicationProvider.getApplicationContext()
    private val opened = mutableListOf<String>()
    private val tasks = listOf(
        domainTask("1", TaskStatus.IN_PROGRESS, TaskPriority.HIGH, title = "Write report"),
        domainTask("2", TaskStatus.TODO, TaskPriority.LOW, title = "Book venue"),
    )

    private fun show() {
        compose.setContent {
            AedstTheme {
                TaskListDetailScreen(
                    state = TaskListState(tasks = tasks, totalCount = tasks.size, isLoading = false),
                    onIntent = {},
                    onOpenTask = { opened += it },
                    onCreateTask = {},
                    detail = { taskId, _, isSinglePane -> Text("detail $taskId single=$isSinglePane") },
                )
            }
        }
    }

    private val selectPrompt get() = context.getString(R.string.tasks_select_prompt)

    @Test
    @Config(qualifiers = "en-w360dp-h800dp")
    fun `the compact layout is accessible`() {
        show()

        compose.assertScreenSemantics("TaskListDetailScreen compact")
    }

    @Test
    @Config(qualifiers = "en-w1000dp-h700dp")
    fun `the expanded two-pane layout is accessible`() {
        show()

        compose.assertScreenSemantics("TaskListDetailScreen expanded")
    }

    @Test
    @Config(qualifiers = "en-w360dp-h800dp")
    fun `compact shows the list only and a tap opens the task through navigation`() {
        show()

        compose.onNodeWithText("Write report").assertIsDisplayed()
        compose.onNodeWithText(selectPrompt).assertDoesNotExist()

        compose.onNodeWithText("Write report").performClick()

        assertEquals(listOf("1"), opened)
        compose.onNodeWithText("detail 1", substring = true).assertDoesNotExist()
    }

    @Test
    @Config(qualifiers = "en-w700dp-h900dp")
    fun `medium without a fold is still one pane`() {
        show()

        compose.onNodeWithText("Book venue").assertIsDisplayed()
        compose.onNodeWithText(selectPrompt).assertDoesNotExist()

        compose.onNodeWithText("Book venue").performClick()

        assertEquals(listOf("2"), opened)
    }

    @Test
    @Config(qualifiers = "en-w1000dp-h700dp")
    fun `expanded shows the list beside a placeholder and selecting swaps the detail in place`() {
        show()

        compose.onNodeWithText("Write report").assertIsDisplayed()
        compose.onNodeWithText(selectPrompt).assertIsDisplayed()

        compose.onNodeWithText("Book venue").performClick()
        compose.waitForIdle()

        assertTrue(opened.isEmpty())
        compose.onNodeWithText("detail 2 single=false").assertIsDisplayed()
        compose.onNodeWithText("Write report").assertIsDisplayed()
    }
}
