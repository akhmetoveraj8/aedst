package com.aedst.core.media.ui

import android.content.Context
import coil3.ImageLoader
import coil3.SingletonImageLoader
import coil3.disk.DiskCache
import coil3.memory.MemoryCache
import com.aedst.core.media.upload.MediaUploadScheduler
import com.aedst.core.media.upload.UploadStaging
import com.aedst.core.testing.FakeDispatcherProvider
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import io.mockk.verify
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Test

class MediaSignOutHookTest {

    private val memory = mockk<MemoryCache>(relaxed = true)
    private val disk = mockk<DiskCache>(relaxed = true)
    private val uploads = mockk<MediaUploadScheduler>(relaxed = true)
    private val staging = mockk<UploadStaging>(relaxed = true)

    @Test
    fun `the end of a session cancels uploads, deletes staged files and empties both image caches`() = runTest {
        SingletonImageLoader.setUnsafe(
            mockk<ImageLoader> {
                every { memoryCache } returns memory
                every { diskCache } returns disk
            },
        )
        val hook = MediaSignOutHook(
            mockk<Context>(relaxed = true),
            uploads,
            staging,
            FakeDispatcherProvider(UnconfinedTestDispatcher()),
        )

        hook.onSessionEnded()

        verify(exactly = 1) { uploads.cancelAll() }
        coVerify(exactly = 1) { staging.deleteAll() }
        verify(exactly = 1) { memory.clear() }
        verify(exactly = 1) { disk.clear() }
    }
}
