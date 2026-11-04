package com.aedst.core.media.upload

import android.content.Context
import com.aedst.core.testing.FakeDispatcherProvider
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.io.File

class UploadStagingTest {

    @TempDir
    lateinit var filesDir: File

    private val context = mockk<Context>()

    private fun staging(): UploadStaging {
        every { context.filesDir } returns filesDir
        return UploadStaging(context, FakeDispatcherProvider(UnconfinedTestDispatcher()))
    }

    private fun stage(staging: UploadStaging, uploadId: String, suffix: String = ".jpg") =
        File(staging.stem(uploadId).path + suffix).apply { writeText("x") }

    private fun staged(): List<String> = File(filesDir, UploadStaging.STAGING_DIR).list().orEmpty().sorted()

    @Test
    fun `delete removes only the files of that upload, whatever their extension`() {
        val staging = staging()
        stage(staging, "a")
        stage(staging, "a", ".mp4")
        stage(staging, "b")

        staging.delete("a")

        assertEquals(listOf("b.jpg"), staged())
    }

    @Test
    fun `sweep keeps the files of active uploads and removes the leftovers of a killed process`() = runTest {
        val staging = staging()
        stage(staging, "running")
        stage(staging, "gone")
        stage(staging, "gone-too", ".mp4")

        val removed = staging.sweep(activeUploadIds = setOf("running"))

        assertEquals(2, removed)
        assertEquals(listOf("running.jpg"), staged())
    }

    @Test
    fun `sweeping an app that never staged anything is a no-op`() = runTest {
        assertEquals(0, staging().sweep(emptySet()))
    }

    @Test
    fun `deleteAll empties the directory`() = runTest {
        val staging = staging()
        stage(staging, "a")
        stage(staging, "b")

        staging.deleteAll()

        assertEquals(emptyList<String>(), staged())
    }
}
