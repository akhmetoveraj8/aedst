package com.aedst.feature.notifications.presentation.preferences

import com.aedst.core.common.AedstError
import com.aedst.core.common.Outcome
import com.aedst.core.testing.MainDispatcherExtension
import com.aedst.feature.notifications.ScriptedNotificationsRepository
import com.aedst.feature.notifications.allEnabled
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.extension.RegisterExtension

class NotificationPreferencesViewModelTest {

    @JvmField
    @RegisterExtension
    val mainDispatcher = MainDispatcherExtension()

    private val repository = ScriptedNotificationsRepository()

    private fun createViewModel() = NotificationPreferencesViewModel(repository)

    @Test
    fun `loads the stored preferences`() = runTest(mainDispatcher.testDispatcher) {
        val viewModel = createViewModel()

        testScheduler.advanceUntilIdle()

        assertEquals(allEnabled, viewModel.state.value.preferences)
    }

    @Test
    fun `a load failure leaves the screen without preferences and reports the error`() =
        runTest(mainDispatcher.testDispatcher) {
            repository.preferencesResult = Outcome.Failure(AedstError.Offline())
            val viewModel = createViewModel()

            testScheduler.advanceUntilIdle()

            assertNull(viewModel.state.value.preferences)
            assertTrue(viewModel.state.value.error is AedstError.Offline)
            viewModel.onIntent(NotificationPreferencesIntent.ErrorShown)
            assertNull(viewModel.state.value.error)
        }

    @Test
    fun `a change is applied at once and confirmed by the server value`() = runTest(mainDispatcher.testDispatcher) {
        val viewModel = createViewModel()
        testScheduler.advanceUntilIdle()

        viewModel.onIntent(NotificationPreferencesIntent.Update { it.copy(taskDueSoon = false) })
        assertFalse(viewModel.state.value.preferences!!.taskDueSoon) // optimistic
        assertTrue(viewModel.state.value.isSaving)
        testScheduler.advanceUntilIdle()

        assertFalse(viewModel.state.value.isSaving)
        assertEquals(listOf(allEnabled.copy(taskDueSoon = false)), repository.updates)
    }

    @Test
    fun `a rejected change reverts to the previous value and shows the error`() =
        runTest(mainDispatcher.testDispatcher) {
            repository.updateResult = { Outcome.Failure(AedstError.InvalidInput("rejected")) }
            val viewModel = createViewModel()
            testScheduler.advanceUntilIdle()

            viewModel.onIntent(NotificationPreferencesIntent.Update { it.copy(pushEnabled = false) })
            testScheduler.advanceUntilIdle()

            assertEquals(allEnabled, viewModel.state.value.preferences)
            assertFalse(viewModel.state.value.isSaving)
            assertTrue(viewModel.state.value.error is AedstError.InvalidInput)
        }

    @Test
    fun `changes before the preferences are loaded are ignored`() = runTest(mainDispatcher.testDispatcher) {
        repository.preferencesResult = Outcome.Failure(AedstError.Offline())
        val viewModel = createViewModel()
        testScheduler.advanceUntilIdle()

        viewModel.onIntent(NotificationPreferencesIntent.Update { it.copy(pushEnabled = false) })
        testScheduler.advanceUntilIdle()

        assertTrue(repository.updates.isEmpty())
    }
}
