package com.aedst.core.security

import com.google.android.gms.tasks.Task
import com.google.android.play.core.integrity.StandardIntegrityManager
import com.google.android.play.core.integrity.StandardIntegrityManager.StandardIntegrityToken
import com.google.android.play.core.integrity.StandardIntegrityManager.StandardIntegrityTokenProvider
import io.mockk.every
import io.mockk.mockk
import io.mockk.verify
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertSame
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class PlayIntegrityFacadeTest {

    private val manager = mockk<StandardIntegrityManager>()
    private val provider = mockk<StandardIntegrityTokenProvider>()

    /** A finished Google Tasks `Task`, the only state `Task.await()` reads without a Looper. */
    private fun providerTask(): Task<StandardIntegrityTokenProvider> = mockk {
        every { isComplete } returns true
        every { isCanceled } returns false
        every { exception } returns null
        every { result } returns provider
    }

    private fun tokenTask(value: String): Task<StandardIntegrityToken> {
        val integrityToken = mockk<StandardIntegrityToken> { every { token() } returns value }
        return mockk {
            every { isComplete } returns true
            every { isCanceled } returns false
            every { exception } returns null
            every { result } returns integrityToken
        }
    }

    private fun failedTokenTask(failure: Exception): Task<StandardIntegrityToken> = mockk {
        every { isComplete } returns true
        every { isCanceled } returns false
        every { exception } returns failure
    }

    @Test
    fun `fails fast without calling Google when no cloud project number is configured`() = runTest {
        val unusedManager = mockk<StandardIntegrityManager>(relaxed = false)
        val facade = PlayIntegrityFacade(unusedManager, PlayIntegrityCloudProject(0))

        val result = facade.requestIntegrityToken("hash")

        assertTrue(result.isFailure)
        assertTrue(result.exceptionOrNull() is IllegalStateException)
    }

    @Test
    fun `returns the token and prepares the provider only once`() = runTest {
        every { manager.prepareIntegrityToken(any()) } returns providerTask()
        every { provider.request(any()) } returnsMany listOf(tokenTask("t1"), tokenTask("t2"))
        val facade = PlayIntegrityFacade(manager, PlayIntegrityCloudProject(42))

        assertEquals("t1", facade.requestIntegrityToken("hash-1").getOrThrow())
        assertEquals("t2", facade.requestIntegrityToken("hash-2").getOrThrow())

        verify(exactly = 1) { manager.prepareIntegrityToken(any()) }
    }

    @Test
    fun `a failed request surfaces the error and the next call prepares a fresh provider`() = runTest {
        val failure = IllegalStateException("TOKEN_PROVIDER_INVALID")
        every { manager.prepareIntegrityToken(any()) } returns providerTask()
        every { provider.request(any()) } returnsMany listOf(failedTokenTask(failure), tokenTask("t2"))
        val facade = PlayIntegrityFacade(manager, PlayIntegrityCloudProject(42))

        val first = facade.requestIntegrityToken("hash-1")
        val second = facade.requestIntegrityToken("hash-2")

        assertSame(failure, first.exceptionOrNull())
        assertEquals("t2", second.getOrThrow())
        verify(exactly = 2) { manager.prepareIntegrityToken(any()) }
    }
}
