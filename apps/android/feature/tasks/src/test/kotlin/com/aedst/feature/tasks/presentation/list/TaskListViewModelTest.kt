package com.aedst.feature.tasks.presentation.list

import app.cash.turbine.test
import com.aedst.core.common.AedstError
import com.aedst.core.common.Outcome
import com.aedst.core.testing.MainDispatcherExtension
import com.aedst.feature.tasks.domain.NewTask
import com.aedst.feature.tasks.domain.Task
import com.aedst.feature.tasks.domain.TaskPage
import com.aedst.feature.tasks.domain.TaskPriority
import com.aedst.feature.tasks.domain.TaskRepository
import com.aedst.feature.tasks.domain.TaskStatus
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.extension.RegisterExtension

class TaskListViewModelTest {

    @JvmField
    @RegisterExtension
    val mainDispatcherRule = MainDispatcherExtension()

    private val repository = FakeTaskRepository()

    @Test
    fun `refresh loads page one, load more appends`() = runTest(mainDispatcherRule.testDispatcher) {
        repository.pages = mapOf(
            null to TaskPage(listOf(task("1"), task("2")), nextPageToken = "p2", totalCount = 3),
            "p2" to TaskPage(listOf(task("3")), nextPageToken = null, totalCount = 0),
        )
        val viewModel = TaskListViewModel(repository)

        viewModel.onIntent(TaskListIntent.Refresh)
        testScheduler.advanceUntilIdle()
        assertEquals(listOf("1", "2"), viewModel.state.value.tasks.map(Task::id))
        assertEquals(3, viewModel.state.value.totalCount)
        assertTrue(viewModel.state.value.canLoadMore)

        viewModel.onIntent(TaskListIntent.LoadMore)
        testScheduler.advanceUntilIdle()
        assertEquals(listOf("1", "2", "3"), viewModel.state.value.tasks.map(Task::id))
        assertFalse(viewModel.state.value.canLoadMore)
    }

    @Test
    fun `failure is shown once as an error kind`() = runTest(mainDispatcherRule.testDispatcher) {
        repository.failure = AedstError.Offline()
        val viewModel = TaskListViewModel(repository)

        viewModel.onIntent(TaskListIntent.Refresh)
        testScheduler.advanceUntilIdle()
        assertTrue(viewModel.state.value.error is AedstError.Offline)
        assertFalse(viewModel.state.value.isLoading)

        viewModel.onIntent(TaskListIntent.ErrorShown)
        assertNull(viewModel.state.value.error)
    }

    @Test
    fun `two overlapping refreshes end with the answer of the last one`() = runTest(mainDispatcherRule.testDispatcher) {
        val first = CompletableDeferred<Outcome<TaskPage>>()
        val second = CompletableDeferred<Outcome<TaskPage>>()
        val answers = ArrayDeque(listOf(first, second))
        val gated = object : TaskRepository by repository {
            override suspend fun list(pageToken: String?): Outcome<TaskPage> = answers.removeFirst().await()
        }
        val viewModel = TaskListViewModel(gated)

        viewModel.state.test {
            assertTrue(awaitItem().isLoading)
            viewModel.onIntent(TaskListIntent.Refresh)
            testScheduler.runCurrent()
            viewModel.onIntent(TaskListIntent.Refresh)
            testScheduler.runCurrent()

            // The newer request answers first, the older one (cancelled) answers late: it must not win.
            second.complete(Outcome.Success(TaskPage(listOf(task("new")), nextPageToken = null, totalCount = 1)))
            first.complete(Outcome.Success(TaskPage(listOf(task("stale")), nextPageToken = null, totalCount = 1)))
            testScheduler.advanceUntilIdle()

            val settled = expectMostRecentItem()
            assertEquals(listOf("new"), settled.tasks.map(Task::id))
            assertFalse(settled.isLoading)
            expectNoEvents()
        }
    }

    @Test
    fun `a page requested before a refresh finishes is dropped, not appended to the new list`() =
        runTest(mainDispatcherRule.testDispatcher) {
            repository.pages = mapOf(
                null to TaskPage(listOf(task("1")), nextPageToken = "p2", totalCount = 2),
                "p2" to TaskPage(listOf(task("2")), nextPageToken = null, totalCount = 2),
            )
            val viewModel = TaskListViewModel(repository)
            viewModel.onIntent(TaskListIntent.Refresh)
            testScheduler.advanceUntilIdle()

            viewModel.onIntent(TaskListIntent.LoadMore)
            viewModel.onIntent(TaskListIntent.Refresh)
            testScheduler.advanceUntilIdle()

            assertEquals(listOf("1"), viewModel.state.value.tasks.map(Task::id))
            assertFalse(viewModel.state.value.isLoadingMore)
        }

    private fun task(id: String) = Task(
        id = id,
        title = "Task $id",
        description = "",
        status = TaskStatus.TODO,
        priority = TaskPriority.MEDIUM,
        dueDate = null,
        createdAt = null,
        completedAt = null,
        version = 1,
    )
}

private class FakeTaskRepository : TaskRepository {
    var pages: Map<String?, TaskPage> = emptyMap()
    var failure: AedstError? = null

    override suspend fun list(pageToken: String?): Outcome<TaskPage> =
        failure?.let { Outcome.Failure(it) } ?: Outcome.Success(pages.getValue(pageToken))

    override suspend fun get(id: String): Outcome<Task> = Outcome.Failure(AedstError.NotFound())

    override suspend fun create(task: NewTask, idempotencyKey: String): Outcome<Task> =
        Outcome.Failure(AedstError.Unknown("unused"))

    override suspend fun complete(id: String, idempotencyKey: String): Outcome<Task> =
        Outcome.Failure(AedstError.Unknown("unused"))

    override suspend fun reopen(id: String): Outcome<Task> = Outcome.Failure(AedstError.Unknown("unused"))

    override suspend fun delete(id: String): Outcome<Unit> = Outcome.Failure(AedstError.Unknown("unused"))
}
