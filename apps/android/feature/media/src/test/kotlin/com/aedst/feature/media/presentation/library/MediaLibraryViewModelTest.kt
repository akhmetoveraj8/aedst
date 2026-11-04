package com.aedst.feature.media.presentation.library

import android.net.Uri
import app.cash.turbine.test
import com.aedst.core.common.AedstError
import com.aedst.core.common.Outcome
import com.aedst.core.media.MediaPage
import com.aedst.core.media.data.MediaRepository
import com.aedst.core.media.upload.MediaUploadScheduler
import com.aedst.core.media.upload.UploadProgress
import com.aedst.core.testing.MainDispatcherExtension
import com.aedst.feature.media.FakeMediaRepository
import com.aedst.feature.media.mediaItem
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

class MediaLibraryViewModelTest {

    @JvmField
    @RegisterExtension
    val mainDispatcher = MainDispatcherExtension()

    private val repository = FakeMediaRepository()
    private val uploadFlow = MutableStateFlow<List<UploadProgress>>(emptyList())
    private val uploads = mockk<MediaUploadScheduler>(relaxed = true) {
        every { observe() } returns uploadFlow
    }

    // Built inside each test: viewModelScope binds to Dispatchers.Main when the ViewModel is constructed, which must
    // happen after the extension installed the test dispatcher (field initialisers run before it).
    private fun createViewModel() = MediaLibraryViewModel(repository, uploads)

    private fun upload(id: String, state: UploadProgress.State) =
        UploadProgress(id, mockk<Uri>(), state, fraction = null, errorKind = null)

    @Test
    fun `the first page is loaded by the start refresh and a second page is appended`() =
        runTest(mainDispatcher.testDispatcher) {
            repository.pages = mapOf(
                null to MediaPage(listOf(mediaItem("1"), mediaItem("2")), nextPageToken = "p2"),
                "p2" to MediaPage(listOf(mediaItem("3")), nextPageToken = null),
            )

            val viewModel = createViewModel()
            viewModel.onIntent(MediaLibraryIntent.Refresh)
            testScheduler.advanceUntilIdle()
            assertEquals(listOf("1", "2"), viewModel.state.value.items.map { it.id })
            assertEquals("p2", viewModel.state.value.nextPageToken)
            assertFalse(viewModel.state.value.isLoading)

            viewModel.onIntent(MediaLibraryIntent.LoadMore)
            testScheduler.advanceUntilIdle()

            assertEquals(listOf("1", "2", "3"), viewModel.state.value.items.map { it.id })
            assertNull(viewModel.state.value.nextPageToken)
            assertEquals(listOf(null, "p2"), repository.listCalls)
        }

    @Test
    fun `load more without a next page does nothing`() = runTest(mainDispatcher.testDispatcher) {
        repository.pages = mapOf(null to MediaPage(listOf(mediaItem("1")), nextPageToken = null))
        val viewModel = createViewModel()
        viewModel.onIntent(MediaLibraryIntent.Refresh)
        testScheduler.advanceUntilIdle()

        viewModel.onIntent(MediaLibraryIntent.LoadMore)
        testScheduler.advanceUntilIdle()

        assertEquals(listOf<String?>(null), repository.listCalls)
    }

    @Test
    fun `refresh replaces the list instead of appending to it`() = runTest(mainDispatcher.testDispatcher) {
        repository.pages = mapOf(null to MediaPage(listOf(mediaItem("1")), nextPageToken = null))
        val viewModel = createViewModel()
        viewModel.onIntent(MediaLibraryIntent.Refresh)
        testScheduler.advanceUntilIdle()
        repository.pages = mapOf(null to MediaPage(listOf(mediaItem("9")), nextPageToken = null))

        viewModel.onIntent(MediaLibraryIntent.Refresh)
        testScheduler.advanceUntilIdle()

        assertEquals(listOf("9"), viewModel.state.value.items.map { it.id })
    }

    @Test
    fun `a failure is reported once as an error kind`() = runTest(mainDispatcher.testDispatcher) {
        repository.failure = AedstError.Offline()

        val viewModel = createViewModel()
        viewModel.onIntent(MediaLibraryIntent.Refresh)
        testScheduler.advanceUntilIdle()

        assertTrue(viewModel.state.value.error is AedstError.Offline)
        assertFalse(viewModel.state.value.isLoading)
        viewModel.onIntent(MediaLibraryIntent.ErrorShown)
        assertNull(viewModel.state.value.error)
    }

    @Test
    fun `a finished upload reloads the library so the new file appears`() = runTest(mainDispatcher.testDispatcher) {
        repository.pages = mapOf(null to MediaPage(emptyList(), nextPageToken = null))
        val viewModel = createViewModel()
        viewModel.onIntent(MediaLibraryIntent.Refresh)
        testScheduler.advanceUntilIdle()
        val callsBefore = repository.listCalls.size

        uploadFlow.value = listOf(upload("u1", UploadProgress.State.DONE))
        testScheduler.advanceUntilIdle()

        assertEquals(callsBefore + 1, repository.listCalls.size)
    }

    @Test
    fun `creating the view model loads nothing, the screen's start refresh does`() =
        runTest(mainDispatcher.testDispatcher) {
            repository.pages = mapOf(null to MediaPage(listOf(mediaItem("1")), nextPageToken = null))

            val viewModel = createViewModel()
            testScheduler.advanceUntilIdle()

            assertTrue(repository.listCalls.isEmpty())
            viewModel.onIntent(MediaLibraryIntent.Refresh)
            testScheduler.advanceUntilIdle()
            assertEquals(listOf<String?>(null), repository.listCalls)
        }

    @Test
    fun `two overlapping refreshes end with the answer of the last one`() = runTest(mainDispatcher.testDispatcher) {
        val first = CompletableDeferred<MediaPage>()
        val second = CompletableDeferred<MediaPage>()
        val answers = ArrayDeque(listOf(first, second))
        val gated = mockk<MediaRepository> {
            coEvery { list(any(), any()) } coAnswers { Outcome.Success(answers.removeFirst().await()) }
        }
        val viewModel = MediaLibraryViewModel(gated, uploads)

        viewModel.state.test {
            awaitItem() // initial
            viewModel.onIntent(MediaLibraryIntent.Refresh)
            testScheduler.runCurrent()
            viewModel.onIntent(MediaLibraryIntent.Refresh)
            testScheduler.runCurrent()

            // The newer request answers first; the older (cancelled) one answers late and must not win.
            second.complete(MediaPage(listOf(mediaItem("new")), nextPageToken = null))
            first.complete(MediaPage(listOf(mediaItem("stale")), nextPageToken = null))
            testScheduler.advanceUntilIdle()

            val settled = expectMostRecentItem()
            assertEquals(listOf("new"), settled.items.map { it.id })
            assertFalse(settled.isLoading)
        }
    }

    @Test
    fun `only uploads in flight are exposed`() = runTest(mainDispatcher.testDispatcher) {
        repository.pages = mapOf(null to MediaPage(emptyList(), nextPageToken = null))
        uploadFlow.value = listOf(
            upload("running", UploadProgress.State.UPLOADING),
            upload("done", UploadProgress.State.DONE),
            upload("cancelled", UploadProgress.State.CANCELLED),
            upload("failed", UploadProgress.State.FAILED),
        )

        val viewModel = createViewModel()

        viewModel.activeUploads.test {
            var latest = awaitItem()
            if (latest.isEmpty()) latest = awaitItem()
            assertEquals(listOf("running", "failed"), latest.map { it.uploadId })
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun `picked files are enqueued one by one, an upload can be cancelled`() = runTest(mainDispatcher.testDispatcher) {
        repository.pages = mapOf(null to MediaPage(emptyList(), nextPageToken = null))
        val first = mockk<Uri>()
        val second = mockk<Uri>()

        val viewModel = createViewModel()

        viewModel.onIntent(MediaLibraryIntent.Upload(listOf(first, second)))
        viewModel.onIntent(MediaLibraryIntent.CancelUpload("u1"))

        verify(exactly = 1) { uploads.enqueue(first) }
        verify(exactly = 1) { uploads.enqueue(second) }
        verify(exactly = 1) { uploads.cancel("u1") }
    }
}
