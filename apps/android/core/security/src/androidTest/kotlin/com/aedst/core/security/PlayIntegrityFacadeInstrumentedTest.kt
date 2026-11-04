package com.aedst.core.security

import android.app.Activity
import com.google.android.gms.tasks.Task
import com.google.android.gms.tasks.Tasks
import com.google.android.play.core.integrity.StandardIntegrityManager
import com.google.android.play.core.integrity.StandardIntegrityManager.PrepareIntegrityTokenRequest
import com.google.android.play.core.integrity.StandardIntegrityManager.StandardIntegrityToken
import com.google.android.play.core.integrity.StandardIntegrityManager.StandardIntegrityTokenProvider
import com.google.android.play.core.integrity.StandardIntegrityManager.StandardIntegrityTokenRequest
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * [PlayIntegrityFacade] against a hand-written fake of the `StandardIntegrityManager` seam, driven by real Google
 * `Task` objects (`Tasks.forResult`) and the real `await()` bridge on a device runtime. It proves the facade's own
 * logic (warm-up once, re-prepare after a failure, fail fast without a project number). It cannot prove that Google
 * issues a token: that needs a Play-signed build on a device (docs/content/android/device-verification.md).
 */
class PlayIntegrityFacadeInstrumentedTest {

    private class FakeManager(private val tokens: ArrayDeque<Result<String>>) : StandardIntegrityManager {
        var prepareCalls = 0
        var lastRequestHash: String? = null

        override fun prepareIntegrityToken(request: PrepareIntegrityTokenRequest): Task<StandardIntegrityTokenProvider> {
            prepareCalls++
            return Tasks.forResult(
                object : StandardIntegrityTokenProvider {
                    override fun request(request: StandardIntegrityTokenRequest): Task<StandardIntegrityToken> {
                        lastRequestHash = request.requestHash()
                        val next = tokens.removeFirst()
                        return next.fold(
                            onSuccess = { Tasks.forResult(FakeToken(it)) },
                            onFailure = { Tasks.forException(it as Exception) },
                        )
                    }
                },
            )
        }
    }

    private class FakeToken(private val value: String) : StandardIntegrityToken() {
        override fun showDialog(activity: Activity, type: Int): Task<Int> = Tasks.forResult(0)

        override fun token(): String = value
    }

    @Test
    fun failsFastWithoutAProjectNumberAndNeverCallsTheManager() = runBlocking {
        val manager = FakeManager(ArrayDeque())

        val result = PlayIntegrityFacade(manager, PlayIntegrityCloudProject(0)).requestIntegrityToken("h")

        assertTrue(result.exceptionOrNull() is IllegalStateException)
        assertEquals(0, manager.prepareCalls)
    }

    @Test
    fun preparesOnceAndBindsTheRequestHash() = runBlocking {
        val manager = FakeManager(ArrayDeque(listOf(Result.success("t1"), Result.success("t2"))))
        val facade = PlayIntegrityFacade(manager, PlayIntegrityCloudProject(42))

        assertEquals("t1", facade.requestIntegrityToken("hash-1").getOrThrow())
        assertEquals("t2", facade.requestIntegrityToken("hash-2").getOrThrow())

        assertEquals(1, manager.prepareCalls)
        assertEquals("hash-2", manager.lastRequestHash)
    }

    @Test
    fun aFailedRequestReturnsFailureAndTheNextCallPreparesAgain() = runBlocking {
        val manager = FakeManager(
            ArrayDeque(listOf(Result.failure(IllegalStateException("TOKEN_PROVIDER_INVALID")), Result.success("t"))),
        )
        val facade = PlayIntegrityFacade(manager, PlayIntegrityCloudProject(7))

        assertTrue(facade.requestIntegrityToken("h").isFailure)
        assertEquals("t", facade.requestIntegrityToken("h").getOrThrow())

        assertEquals(2, manager.prepareCalls)
    }
}
