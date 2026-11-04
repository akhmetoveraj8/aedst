package com.aedst.feature.admin.presentation

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ApplicationProvider
import com.aedst.core.testing.assertScreenSemantics
import com.aedst.core.ui.theme.AedstTheme
import com.aedst.feature.admin.R
import com.aedst.feature.admin.domain.AdminOverview
import com.aedst.feature.admin.domain.AdminTaskRow
import com.aedst.feature.admin.domain.AuditRow
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** [AdminScreen] against synthetic state (Robolectric, English resources; JUnit 4 runner). */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "en")
class AdminScreenTest {

    @get:Rule
    val compose = createComposeRule()

    private val context: Context = ApplicationProvider.getApplicationContext()
    private val overview = AdminOverview(20, 15, 2, 7, 1_024, 3, 0, 1)
    private val task = AdminTaskRow("t1", "u1", "Write report", isDone = false)

    @Test
    fun `every tab is accessible`() {
        var state by mutableStateOf(AdminState(overview = overview))
        compose.setContent { AedstTheme { AdminScreen(state = state, onIntent = {}) } }
        compose.assertScreenSemantics("AdminScreen overview")

        state = AdminState(tab = AdminTab.TASKS, tasks = listOf(task))
        compose.waitForIdle()
        compose.assertScreenSemantics("AdminScreen tasks")

        state = AdminState(
            tab = AdminTab.AUDIT,
            audit = listOf(AuditRow("a1", "u9", "task.delete", "t1", "spam", createdAt = null)),
        )
        compose.waitForIdle()
        compose.assertScreenSemantics("AdminScreen audit")
    }

    @Test
    fun `deleting a task asks for a reason first`() {
        val intents = mutableListOf<AdminIntent>()
        compose.setContent {
            AedstTheme {
                AdminScreen(state = AdminState(tab = AdminTab.TASKS, tasks = listOf(task)), onIntent = {
                    intents += it
                })
            }
        }

        compose.onNodeWithContentDescription(context.getString(R.string.admin_delete_task)).performClick()

        assertEquals(listOf<AdminIntent>(AdminIntent.RequestDelete(task)), intents)
    }
}
