package com.aedst.feature.notifications.presentation.inbox

import com.aedst.core.common.AedstError
import com.aedst.core.testing.MainDispatcherExtension
import com.aedst.feature.notifications.ScriptedNotificationsRepository
import com.aedst.feature.notifications.domain.InboxNotification
import com.aedst.feature.notifications.domain.InboxPage
import com.aedst.feature.notifications.inboxNotification
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.extension.RegisterExtension
import java.time.Instant

class InboxViewModelTest {

    @JvmField
    @RegisterExtension
    val mainDispatcher = MainDispatcherExtension()

    private val repository = ScriptedNotificationsRepository()

    private fun createViewModel() = InboxViewModel(repository)

    @Test
    fun `refresh loads the first page and refreshes the unread badge`() = runTest(mainDispatcher.testDispatcher) {
        repository.pages = mapOf(null to InboxPage(listOf(inboxNotification("1"), inboxNotification("2")), "p2"))
        val viewModel = createViewModel()

        viewModel.onIntent(InboxIntent.Refresh)
        testScheduler.advanceUntilIdle()

        assertEquals(listOf("1", "2"), viewModel.state.value.notifications.map(InboxNotification::id))
        assertEquals("p2", viewModel.state.value.nextPageToken)
        assertFalse(viewModel.state.value.isLoading)
        assertEquals(1, repository.unreadCountCalls)
    }

    @Test
    fun `load more appends the next page, the badge is not refreshed again`() = runTest(mainDispatcher.testDispatcher) {
        repository.pages = mapOf(
            null to InboxPage(listOf(inboxNotification("1")), "p2"),
            "p2" to InboxPage(listOf(inboxNotification("2")), null),
        )
        val viewModel = createViewModel()
        viewModel.onIntent(InboxIntent.Refresh)
        testScheduler.advanceUntilIdle()

        viewModel.onIntent(InboxIntent.LoadMore)
        testScheduler.advanceUntilIdle()

        assertEquals(listOf("1", "2"), viewModel.state.value.notifications.map(InboxNotification::id))
        assertNull(viewModel.state.value.nextPageToken)
        assertEquals(1, repository.unreadCountCalls)
        assertEquals(listOf(null, "p2"), repository.listCalls)
    }

    @Test
    fun `load more without a next page is a no-op`() = runTest(mainDispatcher.testDispatcher) {
        val viewModel = createViewModel()

        viewModel.onIntent(InboxIntent.LoadMore)
        testScheduler.advanceUntilIdle()

        assertTrue(repository.listCalls.isEmpty())
    }

    @Test
    fun `a failure is shown once`() = runTest(mainDispatcher.testDispatcher) {
        repository.listFailure = AedstError.Offline()
        val viewModel = createViewModel()

        viewModel.onIntent(InboxIntent.Refresh)
        testScheduler.advanceUntilIdle()

        assertTrue(viewModel.state.value.error is AedstError.Offline)
        assertFalse(viewModel.state.value.isLoading)
        viewModel.onIntent(InboxIntent.ErrorShown)
        assertNull(viewModel.state.value.error)
    }

    @Test
    fun `opening an unread notification marks it read immediately and on the server`() =
        runTest(mainDispatcher.testDispatcher) {
            repository.pages = mapOf(null to InboxPage(listOf(inboxNotification("1"), inboxNotification("2")), null))
            val viewModel = createViewModel()
            viewModel.onIntent(InboxIntent.Refresh)
            testScheduler.advanceUntilIdle()

            viewModel.onIntent(InboxIntent.Open(viewModel.state.value.notifications.first()))
            // Optimistic: read before the server answered.
            assertFalse(viewModel.state.value.notifications.first().isUnread)
            assertTrue(viewModel.state.value.notifications.last().isUnread)
            testScheduler.advanceUntilIdle()

            assertEquals(listOf(listOf("1")), repository.markedRead)
        }

    @Test
    fun `opening an already read notification does not call the server`() = runTest(mainDispatcher.testDispatcher) {
        val read = inboxNotification("1", readAt = Instant.parse("2026-01-02T00:00:00Z"))
        repository.pages = mapOf(null to InboxPage(listOf(read), null))
        val viewModel = createViewModel()
        viewModel.onIntent(InboxIntent.Refresh)
        testScheduler.advanceUntilIdle()

        viewModel.onIntent(InboxIntent.Open(read))
        testScheduler.advanceUntilIdle()

        assertTrue(repository.markedRead.isEmpty())
    }

    @Test
    fun `mark all read updates every row and reports a server failure`() = runTest(mainDispatcher.testDispatcher) {
        repository.pages = mapOf(null to InboxPage(listOf(inboxNotification("1"), inboxNotification("2")), null))
        repository.markAllReadFailure = AedstError.Unavailable("down")
        val viewModel = createViewModel()
        viewModel.onIntent(InboxIntent.Refresh)
        testScheduler.advanceUntilIdle()
        assertTrue(viewModel.state.value.hasUnread)

        viewModel.onIntent(InboxIntent.MarkAllRead)
        testScheduler.advanceUntilIdle()

        assertFalse(viewModel.state.value.hasUnread)
        assertEquals(1, repository.markAllReadCalls)
        assertTrue(viewModel.state.value.error is AedstError.Unavailable)
    }
}
