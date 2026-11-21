package com.aedst.core.common

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class AedstErrorTest {

    @Test
    fun `network and offline failures are retryable`() {
        assertTrue(AedstError.Unavailable("down").isRetryable)
        assertTrue(AedstError.Offline().isRetryable)
        assertTrue(AedstError.RateLimited().isRetryable)
    }

    @Test
    fun `client, auth and unknown failures are not retryable`() {
        assertFalse(AedstError.Unauthenticated().isRetryable)
        assertFalse(AedstError.NotFound().isRetryable)
        assertFalse(AedstError.InvalidInput("bad").isRetryable)
        assertFalse(AedstError.Unknown("bug").isRetryable)
        assertFalse(AedstError.Forbidden().isRetryable)
        assertFalse(AedstError.Conflict().isRetryable)
    }
}
