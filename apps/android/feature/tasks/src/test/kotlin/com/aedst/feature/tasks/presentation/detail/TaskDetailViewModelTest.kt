package com.aedst.feature.tasks.presentation.detail

import android.net.Uri
import app.cash.turbine.test
import com.aedst.core.analytics.AnalyticsTracker
import com.aedst.core.common.AedstError
import com.aedst.core.common.Outcome
import com.aedst.core.media.MediaItem
import com.aedst.core.media.MediaKind
import com.aedst.core.media.MediaPage
import com.aedst.core.media.MediaStatus
import com.aedst.core.media.data.MediaRepository
import com.aedst.core.media.upload.MediaUploadScheduler
import com.aedst.core.media.upload.UploadProgress
import com.aedst.core.testing.MainDispatcherExtension
import com.aedst.feature.tasks.FakeNetworkMonitor
import com.aedst.feature.tasks.FakeTaskWriteQueue
import com.aedst.feature.tasks.ScriptedTaskRepository
import com.aedst.feature.tasks.domain.CompleteTaskUseCase
import com.aedst.feature.tasks.domain.Task
import com.aedst.feature.tasks.domain.TaskRepository
import com.aedst.feature.tasks.domain.TaskStatus
import com.aedst.feature.tasks.domainTask
import io.mockk.coEvery
import io.mockk.every
import io.mockk.mockk
import io.mockk.verify
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.extension.RegisterExtension

class TaskDetailViewModelTest {

    @JvmField
    @RegisterExtension
    val mainDispatcher = MainDispatcherExtension()

    private val tasks = ScriptedTaskRepository()
    private val analytics = mockk<AnalyticsTracker>(relaxed = true)
    private val uploadFlow = MutableStateFlow<List<UploadProgress>>(emptyList())
    private val uploads = mockk<MediaUploadScheduler>(relaxed = true) {
        every { observe(TASK_ID) } returns uploadFlow
    }
    private val attachments = mutableListOf<MediaItem>()
    private val media = mockk<MediaRepository> {
        coEvery { list(TASK_ID, any()) } answers { Outcome.Success(MediaPage(attachments.toList(), null)) }
    }

    private val queue = FakeTaskWriteQueue()
    private val network = FakeNetworkMonitor()

    private fun createViewModel() = TaskDetailViewModel(
        TASK_ID,
        tasks,
        CompleteTaskUseCase(tasks, queue, network),
        media,
        uploads,
        analytics,
    )

    private fun attachment(id: String) = MediaItem(
        id = id,
        kind = MediaKind.IMAGE,
        status = MediaStatus.READY,
        filename = "$id.jpg",
        contentType = "image/jpeg",
        sizeBytes = 1,
        width = 1,
        height = 1,
        durationMs = 0,
        url = "https://cdn.example/$id",
        presetUrls = emptyMap(),
        posterUrl = null,
        taskId = TASK_ID,
        createdAt = null,
        failureReason = null,
    )

    @Test
    fun `loads the task and its attachments`() = runTest(mainDispatcher.testDispatcher) {
        tasks.getResult = Outcome.Success(domainTask(TASK_ID))
        attachments += attachment("a1")
        val viewModel = createViewModel()

        testScheduler.advanceUntilIdle()

        assertEquals(TASK_ID, viewModel.state.value.task?.id)
        assertEquals(listOf("a1"), viewModel.state.value.attachments.map(MediaItem::id))
        assertFalse(viewModel.state.value.isLoading)
    }

    @Test
    fun `a task that cannot be loaded is reported, not an endless spinner`() = runTest(mainDispatcher.testDispatcher) {
        tasks.getResult = Outcome.Failure(AedstError.NotFound())
        val viewModel = createViewModel()

        testScheduler.advanceUntilIdle()

        assertNull(viewModel.state.value.task)
        assertFalse(viewModel.state.value.isLoading)
        assertTrue(viewModel.state.value.error is AedstError.NotFound)
        viewModel.onIntent(TaskDetailIntent.ErrorShown)
        assertNull(viewModel.state.value.error)
    }

    @Test
    fun `completing an open task tracks it and tells the list to reload`() = runTest(mainDispatcher.testDispatcher) {
        tasks.getResult = Outcome.Success(domainTask(TASK_ID, TaskStatus.TODO))
        tasks.completeResult = Outcome.Success(domainTask(TASK_ID, TaskStatus.DONE))
        val viewModel = createViewModel()
        testScheduler.advanceUntilIdle()

        viewModel.effects.test {
            viewModel.onIntent(TaskDetailIntent.ToggleDone)
            testScheduler.advanceUntilIdle()

            assertEquals(TaskDetailEffect.Changed, awaitItem())
        }

        assertEquals(listOf(TASK_ID), tasks.completed)
        assertEquals(TaskStatus.DONE, viewModel.state.value.task?.status)
        assertFalse(viewModel.state.value.isMutating)
        verify(exactly = 1) { analytics.logEvent("task_completed") }
    }

    @Test
    fun `toggling a finished task reopens it without a completion event`() = runTest(mainDispatcher.testDispatcher) {
        tasks.getResult = Outcome.Success(domainTask(TASK_ID, TaskStatus.DONE))
        tasks.reopenResult = Outcome.Success(domainTask(TASK_ID, TaskStatus.TODO))
        val viewModel = createViewModel()
        testScheduler.advanceUntilIdle()

        viewModel.onIntent(TaskDetailIntent.ToggleDone)
        testScheduler.advanceUntilIdle()

        assertEquals(listOf(TASK_ID), tasks.reopened)
        assertEquals(TaskStatus.TODO, viewModel.state.value.task?.status)
        verify(exactly = 0) { analytics.logEvent("task_completed") }
    }

    @Test
    fun `a failed toggle keeps the task and shows the error`() = runTest(mainDispatcher.testDispatcher) {
        tasks.getResult = Outcome.Success(domainTask(TASK_ID, TaskStatus.TODO))
        tasks.completeResult = Outcome.Failure(AedstError.Conflict())
        val viewModel = createViewModel()
        testScheduler.advanceUntilIdle()

        viewModel.onIntent(TaskDetailIntent.ToggleDone)
        testScheduler.advanceUntilIdle()

        assertEquals(TaskStatus.TODO, viewModel.state.value.task?.status)
        assertFalse(viewModel.state.value.isMutating)
        assertTrue(viewModel.state.value.error is AedstError.Conflict)
    }

    @Test
    fun `deleting emits one deleted effect, a failure does not`() = runTest(mainDispatcher.testDispatcher) {
        tasks.getResult = Outcome.Success(domainTask(TASK_ID))
        val viewModel = createViewModel()
        testScheduler.advanceUntilIdle()

        viewModel.effects.test {
            viewModel.onIntent(TaskDetailIntent.Delete)
            testScheduler.advanceUntilIdle()
            assertEquals(TaskDetailEffect.Deleted, awaitItem())
            expectNoEvents()
        }
        assertEquals(listOf(TASK_ID), tasks.deleted)

        tasks.deleteResult = Outcome.Failure(AedstError.Forbidden())
        val second = createViewModel()
        testScheduler.advanceUntilIdle()
        second.onIntent(TaskDetailIntent.Delete)
        testScheduler.advanceUntilIdle()
        assertTrue(second.state.value.error is AedstError.Forbidden)
        assertFalse(second.state.value.isMutating)
    }

    @Test
    fun `picked files are uploaded against this task and counted`() = runTest(mainDispatcher.testDispatcher) {
        tasks.getResult = Outcome.Success(domainTask(TASK_ID))
        val viewModel = createViewModel()
        testScheduler.advanceUntilIdle()
        val first = mockk<Uri>()
        val second = mockk<Uri>()

        viewModel.onIntent(TaskDetailIntent.Attach(listOf(first, second)))
        viewModel.onIntent(TaskDetailIntent.CancelUpload("u1"))

        verify(exactly = 1) { uploads.enqueue(first, TASK_ID) }
        verify(exactly = 1) { uploads.enqueue(second, TASK_ID) }
        verify(exactly = 1) { uploads.cancel("u1") }
        verify(exactly = 1) { analytics.logEvent("task_attachment_added", mapOf("count" to 2)) }
    }

    @Test
    fun `a finished upload reloads the attachments`() = runTest(mainDispatcher.testDispatcher) {
        tasks.getResult = Outcome.Success(domainTask(TASK_ID))
        val viewModel = createViewModel()
        testScheduler.advanceUntilIdle()
        assertTrue(viewModel.state.value.attachments.isEmpty())

        attachments += attachment("fresh")
        uploadFlow.value = listOf(
            UploadProgress("u1", mockk<Uri>(), UploadProgress.State.DONE, fraction = null, errorKind = null),
        )
        testScheduler.advanceUntilIdle()

        assertEquals(listOf("fresh"), viewModel.state.value.attachments.map(MediaItem::id))
    }

    @Test
    fun `completing offline shows the task as done, queues it and blocks a reopen until synced`() =
        runTest(mainDispatcher.testDispatcher) {
            tasks.getResult = Outcome.Success(domainTask(TASK_ID, TaskStatus.TODO))
            network.state.value = false
            val viewModel = createViewModel()
            testScheduler.advanceUntilIdle()

            viewModel.onIntent(TaskDetailIntent.ToggleDone)
            testScheduler.advanceUntilIdle()

            assertEquals(TaskStatus.DONE, viewModel.state.value.task?.status)
            assertTrue(viewModel.state.value.isPendingSync)
            assertFalse(viewModel.state.value.isMutating)
            assertEquals(TASK_ID, queue.queued.single().completedTaskId)
            assertTrue(tasks.completed.isEmpty())

            viewModel.onIntent(TaskDetailIntent.ToggleDone)
            testScheduler.advanceUntilIdle()
            assertTrue(tasks.reopened.isEmpty())
        }

    @Test
    fun `two overlapping loads end with the answer of the last one`() = runTest(mainDispatcher.testDispatcher) {
        val slowFirst = CompletableDeferred<Outcome<Task>>()
        val getCalls = mutableListOf<CompletableDeferred<Outcome<Task>>>()
        val gated = object : TaskRepository by tasks {
            override suspend fun get(id: String): Outcome<Task> {
                val answer = if (getCalls.isEmpty()) {
                    slowFirst
                } else {
                    CompletableDeferred<Outcome<Task>>().also {
                        it.complete(Outcome.Success(domainTask(id, title = "second")))
                    }
                }
                getCalls += answer
                return answer.await()
            }
        }
        val viewModel = TaskDetailViewModel(
            TASK_ID,
            gated,
            CompleteTaskUseCase(tasks, queue, network),
            media,
            uploads,
            analytics,
        )
        testScheduler.runCurrent() // the first load is now waiting on slowFirst

        viewModel.onIntent(TaskDetailIntent.Refresh)
        testScheduler.advanceUntilIdle()
        slowFirst.complete(Outcome.Success(domainTask(TASK_ID, title = "first")))
        testScheduler.advanceUntilIdle()

        assertEquals("second", viewModel.state.value.task?.title)
        assertFalse(viewModel.state.value.isLoading)
    }

    private companion object {
        const val TASK_ID = "t1"
    }
}
