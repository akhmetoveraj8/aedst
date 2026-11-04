package com.aedst.core.media.upload

import androidx.work.ListenableWorker
import com.aedst.core.common.AedstError
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class UploadWorkDataTest {

    @Test
    fun `presigned headers survive the WorkManager Data round trip`() {
        val headers = mapOf("Content-Type" to "image/webp", "x-amz-checksum-sha256" to "abc=")
        assertEquals(headers, UploadWorkData.decodeHeaders(UploadWorkData.encodeHeaders(headers)))
        assertEquals(emptyMap<String, String>(), UploadWorkData.decodeHeaders("not json"))
        assertEquals(emptyMap<String, String>(), UploadWorkData.decodeHeaders(null))
    }

    @Test
    fun `retryable errors retry until the attempt budget is spent, others fail at once`() {
        assertTrue(UploadWorkData.resultFor(AedstError.Unavailable("x"), 0) is ListenableWorker.Result.Retry)
        assertTrue(
            UploadWorkData.resultFor(AedstError.Unavailable("x"), UploadWorkData.MAX_ATTEMPTS) is
                ListenableWorker.Result.Failure,
        )
        assertTrue(UploadWorkData.resultFor(AedstError.InvalidInput("x"), 0) is ListenableWorker.Result.Failure)
    }

    @Test
    fun `a step is retried exactly when its failure is retryable and attempts remain`() {
        assertTrue(UploadWorkData.willRetry(AedstError.Offline(), 0))
        assertTrue(!UploadWorkData.willRetry(AedstError.Offline(), UploadWorkData.MAX_ATTEMPTS))
        assertTrue(!UploadWorkData.willRetry(AedstError.Forbidden(), 0))
    }
}
