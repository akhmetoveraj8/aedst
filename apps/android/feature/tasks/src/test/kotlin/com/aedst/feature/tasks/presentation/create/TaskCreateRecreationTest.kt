package com.aedst.feature.tasks.presentation.create

import androidx.lifecycle.SavedStateHandle
import com.aedst.core.analytics.AnalyticsTracker
import com.aedst.feature.tasks.FakeNetworkMonitor
import com.aedst.feature.tasks.FakeTaskWriteQueue
import com.aedst.feature.tasks.ScriptedTaskRepository
import com.aedst.feature.tasks.domain.CreateTaskUseCase
import com.aedst.feature.tasks.domain.TaskPriority
import io.mockk.mockk
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * What the system really does when it kills the process of an app in the background: it saves the
 * [SavedStateHandle] into a `Bundle` and hands the Bundle to the next process, which builds a new handle (and a new
 * ViewModel) from it. Robolectric supplies the real `Bundle` (JUnit 4 runner, see libs.versions.toml).
 */
@RunWith(RobolectricTestRunner::class)
class TaskCreateRecreationTest {

    private fun viewModel(handle: SavedStateHandle) = TaskCreateViewModel(
        handle,
        CreateTaskUseCase(ScriptedTaskRepository(), FakeTaskWriteQueue(), FakeNetworkMonitor()),
        mockk<AnalyticsTracker>(relaxed = true),
    )

    @Test
    fun `the draft survives a save and restore through a Bundle`() {
        val before = SavedStateHandle()
        val viewModel = viewModel(before)
        viewModel.onIntent(TaskCreateIntent.TitleChanged("Write the quarterly report"))
        viewModel.onIntent(TaskCreateIntent.DescriptionChanged("numbers from finance"))
        viewModel.onIntent(TaskCreateIntent.PriorityChanged(TaskPriority.URGENT))

        val bundle = before.savedStateProvider().saveState()
        val after = viewModel(SavedStateHandle.createHandle(bundle, null))

        assertEquals("Write the quarterly report", after.state.value.title)
        assertEquals("numbers from finance", after.state.value.description)
        assertEquals(TaskPriority.URGENT, after.state.value.priority)
    }

    @Test
    fun `an untouched form restores to the defaults`() {
        val bundle = SavedStateHandle().savedStateProvider().saveState()

        val after = viewModel(SavedStateHandle.createHandle(bundle, null))

        assertEquals(TaskCreateState(), after.state.value)
    }
}
