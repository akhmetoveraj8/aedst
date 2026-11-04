package com.aedst.feature.media.presentation.detail

import app.cash.turbine.test
import com.aedst.core.common.AedstError
import com.aedst.core.testing.MainDispatcherExtension
import com.aedst.feature.media.FakeMediaRepository
import com.aedst.feature.media.mediaItem
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.extension.RegisterExtension

class MediaDetailViewModelTest {

    @JvmField
    @RegisterExtension
    val mainDispatcher = MainDispatcherExtension()

    private val repository = FakeMediaRepository()

    private fun createViewModel(id: String = "m1") = MediaDetailViewModel(id, repository)

    @Test
    fun `loads the item with fresh urls`() = runTest(mainDispatcher.testDispatcher) {
        repository.items = mapOf("m1" to mediaItem("m1"))
        val viewModel = createViewModel()

        testScheduler.advanceUntilIdle()

        assertEquals("m1", viewModel.state.value.item?.id)
        assertFalse(viewModel.state.value.isLoading)
        assertNull(viewModel.state.value.error)
    }

    @Test
    fun `a missing item is an error, not an endless spinner`() = runTest(mainDispatcher.testDispatcher) {
        val viewModel = createViewModel("gone")

        testScheduler.advanceUntilIdle()

        assertNull(viewModel.state.value.item)
        assertFalse(viewModel.state.value.isLoading)
        assertTrue(viewModel.state.value.error is AedstError.NotFound)
        viewModel.onIntent(MediaDetailIntent.ErrorShown)
        assertNull(viewModel.state.value.error)
    }

    @Test
    fun `deleting removes the item remotely and emits one deleted event`() = runTest(mainDispatcher.testDispatcher) {
        repository.items = mapOf("m1" to mediaItem("m1"))
        val viewModel = createViewModel()
        testScheduler.advanceUntilIdle()

        viewModel.effects.test {
            viewModel.onIntent(MediaDetailIntent.Delete)
            testScheduler.advanceUntilIdle()
            assertEquals(MediaDetailEffect.Deleted, awaitItem())
            expectNoEvents()
        }

        assertEquals(listOf("m1"), repository.deleted)
    }

    @Test
    fun `a second tap while deleting is ignored`() = runTest(mainDispatcher.testDispatcher) {
        repository.items = mapOf("m1" to mediaItem("m1"))
        val viewModel = createViewModel()
        testScheduler.advanceUntilIdle()

        viewModel.onIntent(MediaDetailIntent.Delete)
        viewModel.onIntent(MediaDetailIntent.Delete)
        testScheduler.advanceUntilIdle()

        assertEquals(listOf("m1"), repository.deleted)
    }

    @Test
    fun `a failed delete re-enables the screen and reports the error`() = runTest(mainDispatcher.testDispatcher) {
        repository.items = mapOf("m1" to mediaItem("m1"))
        repository.deleteFailure = AedstError.Forbidden()
        val viewModel = createViewModel()
        testScheduler.advanceUntilIdle()

        viewModel.onIntent(MediaDetailIntent.Delete)
        testScheduler.advanceUntilIdle()

        assertFalse(viewModel.state.value.isDeleting)
        assertTrue(viewModel.state.value.error is AedstError.Forbidden)
        assertEquals("m1", viewModel.state.value.item?.id)
    }
}
