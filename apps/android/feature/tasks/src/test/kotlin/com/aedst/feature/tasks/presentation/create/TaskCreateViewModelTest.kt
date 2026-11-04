package com.aedst.feature.tasks.presentation.create

import androidx.lifecycle.SavedStateHandle
import app.cash.turbine.test
import com.aedst.core.analytics.AnalyticsTracker
import com.aedst.core.common.AedstError
import com.aedst.core.common.Outcome
import com.aedst.core.testing.MainDispatcherExtension
import com.aedst.feature.tasks.FakeNetworkMonitor
import com.aedst.feature.tasks.FakeTaskWriteQueue
import com.aedst.feature.tasks.ScriptedTaskRepository
import com.aedst.feature.tasks.domain.CreateTaskUseCase
import com.aedst.feature.tasks.domain.TaskPriority
import com.aedst.feature.tasks.domainTask
import io.mockk.mockk
import io.mockk.verify
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.extension.RegisterExtension

class TaskCreateViewModelTest {

    @JvmField
    @RegisterExtension
    val mainDispatcher = MainDispatcherExtension()

    private val repository = ScriptedTaskRepository()
    private val analytics = mockk<AnalyticsTracker>(relaxed = true)

    private val queue = FakeTaskWriteQueue()
    private val network = FakeNetworkMonitor()

    private fun createViewModel(savedState: SavedStateHandle = SavedStateHandle()) =
        TaskCreateViewModel(savedState, CreateTaskUseCase(repository, queue, network), analytics)

    @Test
    fun `a blank title is flagged and never reaches the repository`() = runTest(mainDispatcher.testDispatcher) {
        val viewModel = createViewModel()
        viewModel.onIntent(TaskCreateIntent.TitleChanged("   "))

        viewModel.onIntent(TaskCreateIntent.Submit)
        testScheduler.advanceUntilIdle()

        assertTrue(viewModel.state.value.isTitleInvalid)
        assertFalse(viewModel.state.value.isSaving)
        assertTrue(repository.created.isEmpty())
    }

    @Test
    fun `typing clears the invalid flag and the inputs are capped to the proto limits`() =
        runTest(mainDispatcher.testDispatcher) {
            val viewModel = createViewModel()
            viewModel.onIntent(TaskCreateIntent.Submit)
            testScheduler.advanceUntilIdle()
            assertTrue(viewModel.state.value.isTitleInvalid)

            viewModel.onIntent(TaskCreateIntent.TitleChanged("t".repeat(250)))
            viewModel.onIntent(TaskCreateIntent.DescriptionChanged("d".repeat(5_000)))

            assertFalse(viewModel.state.value.isTitleInvalid)
            assertEquals(200, viewModel.state.value.title.length)
            assertEquals(4_000, viewModel.state.value.description.length)
        }

    @Test
    fun `a successful submit sends the form, tracks it and emits the new id once`() =
        runTest(mainDispatcher.testDispatcher) {
            repository.createResult = Outcome.Success(domainTask("new-1"))
            val viewModel = createViewModel()
            viewModel.onIntent(TaskCreateIntent.TitleChanged("Write report"))
            viewModel.onIntent(TaskCreateIntent.DescriptionChanged("quarterly"))
            viewModel.onIntent(TaskCreateIntent.PriorityChanged(TaskPriority.URGENT))

            viewModel.effects.test {
                viewModel.onIntent(TaskCreateIntent.Submit)
                testScheduler.advanceUntilIdle()

                assertEquals(TaskCreateEffect.Created("new-1"), awaitItem())
                expectNoEvents()
            }

            val sent = repository.created.single()
            assertEquals("Write report", sent.title)
            assertEquals("quarterly", sent.description)
            assertEquals(TaskPriority.URGENT, sent.priority)
            assertFalse(viewModel.state.value.isSaving)
            verify(exactly = 1) { analytics.logEvent("task_created", mapOf("priority" to "urgent")) }
        }

    @Test
    fun `a failed submit stays on the form with the error kind`() = runTest(mainDispatcher.testDispatcher) {
        repository.createResult = Outcome.Failure(AedstError.InvalidInput("title too long"))
        val viewModel = createViewModel()
        viewModel.onIntent(TaskCreateIntent.TitleChanged("Write report"))

        viewModel.onIntent(TaskCreateIntent.Submit)
        testScheduler.advanceUntilIdle()

        assertTrue(viewModel.state.value.error is AedstError.InvalidInput)
        assertFalse(viewModel.state.value.isSaving)
        viewModel.onIntent(TaskCreateIntent.ErrorShown)
        assertNull(viewModel.state.value.error)
    }

    @Test
    fun `submitting twice while the first request is running creates one task`() =
        runTest(mainDispatcher.testDispatcher) {
            repository.createResult = Outcome.Success(domainTask("new-1"))
            val viewModel = createViewModel()
            viewModel.onIntent(TaskCreateIntent.TitleChanged("Write report"))

            viewModel.onIntent(TaskCreateIntent.Submit)
            viewModel.onIntent(TaskCreateIntent.Submit)
            testScheduler.advanceUntilIdle()

            assertEquals(1, repository.created.size)
        }

    @Test
    fun `offline the task is queued, the form is emptied and no navigation happens`() =
        runTest(mainDispatcher.testDispatcher) {
            network.state.value = false
            val viewModel = createViewModel()
            viewModel.onIntent(TaskCreateIntent.TitleChanged("Write report"))
            viewModel.onIntent(TaskCreateIntent.PriorityChanged(TaskPriority.HIGH))

            viewModel.effects.test {
                viewModel.onIntent(TaskCreateIntent.Submit)
                testScheduler.advanceUntilIdle()

                expectNoEvents()
            }

            val state = viewModel.state.value
            assertTrue(state.isQueued)
            assertFalse(state.isSaving)
            assertEquals("", state.title)
            assertEquals(TaskPriority.HIGH, state.priority)
            assertEquals("Write report", queue.queued.single().task?.title)
            assertTrue(repository.created.isEmpty())

            viewModel.onIntent(TaskCreateIntent.TitleChanged("Next"))
            assertFalse(viewModel.state.value.isQueued)
        }

    @Test
    fun `the draft survives the process being recreated through the saved state`() =
        runTest(mainDispatcher.testDispatcher) {
            val first = SavedStateHandle()
            val viewModel = createViewModel(first)
            viewModel.onIntent(TaskCreateIntent.TitleChanged("Write report"))
            viewModel.onIntent(TaskCreateIntent.DescriptionChanged("quarterly"))
            viewModel.onIntent(TaskCreateIntent.PriorityChanged(TaskPriority.URGENT))

            // What the system keeps across process death is the handle's map, handed to the new ViewModel.
            val restored = createViewModel(SavedStateHandle(first.keys().associateWith { first.get<Any>(it) }))

            assertEquals("Write report", restored.state.value.title)
            assertEquals("quarterly", restored.state.value.description)
            assertEquals(TaskPriority.URGENT, restored.state.value.priority)
        }
}
