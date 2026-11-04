package com.aedst.feature.admin.presentation

import com.aedst.core.common.AedstError
import com.aedst.core.common.Outcome
import com.aedst.core.common.SessionState
import com.aedst.core.common.SessionUser
import com.aedst.core.testing.MainDispatcherExtension
import com.aedst.feature.admin.domain.AdminOverview
import com.aedst.feature.admin.domain.AdminRepository
import com.aedst.feature.admin.domain.AdminTaskRow
import com.aedst.feature.admin.domain.AuditRow
import com.aedst.feature.admin.domain.Page
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.extension.RegisterExtension

class AdminViewModelTest {

    @JvmField
    @RegisterExtension
    val mainDispatcher = MainDispatcherExtension()

    private val repository = FakeAdminRepository()

    private fun session(isAdmin: Boolean) = object : SessionState {
        override val isSignedIn: StateFlow<Boolean?> = MutableStateFlow(true)
        override val currentUser: StateFlow<SessionUser?> =
            MutableStateFlow(SessionUser("u1", if (isAdmin) setOf(SessionUser.ROLE_ADMIN) else emptySet()))
    }

    private fun TestScope.createViewModel(isAdmin: Boolean = true): AdminViewModel {
        val viewModel = AdminViewModel(session(isAdmin), repository)
        testScheduler.advanceUntilIdle()
        return viewModel
    }

    @Test
    fun `an admin lands on the overview, which is loaded once`() = runTest(mainDispatcher.testDispatcher) {
        val viewModel = createViewModel()

        assertTrue(viewModel.isAdmin.value)
        assertEquals(OVERVIEW, viewModel.state.value.overview)
        assertFalse(viewModel.state.value.isLoading)
        assertEquals(1, repository.overviewCalls)
    }

    @Test
    fun `a non-admin triggers no admin call at all`() = runTest(mainDispatcher.testDispatcher) {
        val viewModel = createViewModel(isAdmin = false)

        assertFalse(viewModel.isAdmin.value)
        assertEquals(0, repository.overviewCalls)
        assertNull(viewModel.state.value.overview)
    }

    @Test
    fun `selecting a tab loads it and clears the previous query`() = runTest(mainDispatcher.testDispatcher) {
        repository.tasks = Outcome.Success(Page(listOf(TASK_A), null))
        val viewModel = createViewModel()
        viewModel.onIntent(AdminIntent.QueryChanged("stale"))

        viewModel.onIntent(AdminIntent.SelectTab(AdminTab.TASKS))
        testScheduler.advanceUntilIdle()

        assertEquals(AdminTab.TASKS, viewModel.state.value.tab)
        assertEquals("", viewModel.state.value.query)
        assertEquals(listOf("a"), viewModel.state.value.tasks.map(AdminTaskRow::id))
        assertEquals(listOf(""), repository.taskQueries)
    }

    @Test
    fun `search sends the typed query for the current tab`() = runTest(mainDispatcher.testDispatcher) {
        val viewModel = createViewModel()
        viewModel.onIntent(AdminIntent.SelectTab(AdminTab.TASKS))
        testScheduler.advanceUntilIdle()

        viewModel.onIntent(AdminIntent.QueryChanged("invoice"))
        viewModel.onIntent(AdminIntent.Search)
        testScheduler.advanceUntilIdle()

        assertEquals(listOf("", "invoice"), repository.taskQueries)
    }

    @Test
    fun `a failure is shown once and keeps the previously loaded data`() = runTest(mainDispatcher.testDispatcher) {
        val viewModel = createViewModel()
        repository.audit = Outcome.Failure(AedstError.Forbidden())

        viewModel.onIntent(AdminIntent.SelectTab(AdminTab.AUDIT))
        testScheduler.advanceUntilIdle()

        assertTrue(viewModel.state.value.error is AedstError.Forbidden)
        assertEquals(OVERVIEW, viewModel.state.value.overview)
        viewModel.onIntent(AdminIntent.ErrorShown)
        assertNull(viewModel.state.value.error)
    }

    @Test
    fun `deleting needs a confirmed reason and removes the row afterwards`() = runTest(mainDispatcher.testDispatcher) {
        repository.tasks = Outcome.Success(Page(listOf(TASK_A, TASK_B), null))
        val viewModel = createViewModel()
        viewModel.onIntent(AdminIntent.SelectTab(AdminTab.TASKS))
        testScheduler.advanceUntilIdle()

        viewModel.onIntent(AdminIntent.RequestDelete(TASK_A))
        assertEquals(TASK_A, viewModel.state.value.pendingDelete)

        viewModel.onIntent(AdminIntent.ConfirmDelete("  x "))
        testScheduler.advanceUntilIdle()
        assertTrue(repository.deletions.isEmpty(), "a too short reason must not reach the server")
        assertEquals(TASK_A, viewModel.state.value.pendingDelete)

        viewModel.onIntent(AdminIntent.ConfirmDelete("spam content"))
        testScheduler.advanceUntilIdle()

        assertEquals(listOf("a" to "spam content"), repository.deletions)
        assertNull(viewModel.state.value.pendingDelete)
        assertEquals(listOf("b"), viewModel.state.value.tasks.map(AdminTaskRow::id))
    }

    @Test
    fun `a failed delete keeps the row and reports the error`() = runTest(mainDispatcher.testDispatcher) {
        repository.tasks = Outcome.Success(Page(listOf(TASK_A), null))
        repository.delete = Outcome.Failure(AedstError.Conflict())
        val viewModel = createViewModel()
        viewModel.onIntent(AdminIntent.SelectTab(AdminTab.TASKS))
        testScheduler.advanceUntilIdle()
        viewModel.onIntent(AdminIntent.RequestDelete(TASK_A))

        viewModel.onIntent(AdminIntent.ConfirmDelete("duplicate entry"))
        testScheduler.advanceUntilIdle()

        assertEquals(listOf("a"), viewModel.state.value.tasks.map(AdminTaskRow::id))
        assertTrue(viewModel.state.value.error is AedstError.Conflict)
    }

    @Test
    fun `dismissing the dialog forgets the pending task`() = runTest(mainDispatcher.testDispatcher) {
        val viewModel = createViewModel()
        viewModel.onIntent(AdminIntent.RequestDelete(TASK_A))

        viewModel.onIntent(AdminIntent.DismissDelete)

        assertNull(viewModel.state.value.pendingDelete)
    }

    private class FakeAdminRepository : AdminRepository {
        var overview: Outcome<AdminOverview> = Outcome.Success(OVERVIEW)
        var tasks: Outcome<Page<AdminTaskRow>> = Outcome.Success(Page(emptyList(), null))
        var audit: Outcome<Page<AuditRow>> = Outcome.Success(Page(emptyList(), null))
        var delete: Outcome<Unit> = Outcome.Success(Unit)

        var overviewCalls = 0
        val taskQueries = mutableListOf<String>()
        val deletions = mutableListOf<Pair<String, String>>()

        override suspend fun overview(): Outcome<AdminOverview> {
            overviewCalls++
            return overview
        }

        override suspend fun tasks(query: String, pageToken: String?): Outcome<Page<AdminTaskRow>> {
            taskQueries += query
            return tasks
        }

        override suspend fun deleteTask(id: String, reason: String): Outcome<Unit> {
            deletions += id to reason
            return delete
        }

        override suspend fun auditLog(pageToken: String?): Outcome<Page<AuditRow>> = audit
    }

    private companion object {
        val OVERVIEW = AdminOverview(
            tasksTotal = 20,
            tasksDone = 5,
            tasksOverdue = 2,
            mediaTotal = 7,
            mediaBytes = 1_024,
            pushDevices = 3,
            outboxLagSeconds = 0,
            jobsPending = 1,
        )
        val TASK_A = AdminTaskRow(id = "a", ownerId = "o1", title = "A", isDone = false)
        val TASK_B = AdminTaskRow(id = "b", ownerId = "o2", title = "B", isDone = true)
    }
}
