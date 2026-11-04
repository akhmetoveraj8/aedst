package com.aedst.feature.auth.data.attestation

import com.aedst.core.analytics.AnalyticsTracker
import com.aedst.core.common.Logger
import com.aedst.core.security.IntegrityFacade
import com.aedst.core.testing.FakeDispatcherProvider
import com.aedst.feature.auth.domain.model.DeviceAttestation
import com.aedst.feature.auth.domain.repository.DeviceAttestor
import com.aedst.feature.auth.domain.usecase.AttestDeviceUseCase
import com.aedst.integrity.v1.DeviceVerdict
import com.aedst.integrity.v1.FailureReason
import com.aedst.integrity.v1.IntegrityServiceClientInterface
import com.aedst.integrity.v1.VerifyIntegrityTokenRequest
import com.aedst.integrity.v1.verifyIntegrityTokenResponse
import com.connectrpc.Code
import com.connectrpc.ConnectException
import com.connectrpc.ResponseMessage
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import io.mockk.slot
import io.mockk.verify
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class DeviceAttestorTest {

    private val facade: IntegrityFacade = mockk()
    private val client: IntegrityServiceClientInterface = mockk()
    private val attestor = PlayIntegrityDeviceAttestor(facade, client, ApplicationId("com.aedst.android"))

    @Test
    fun `request hash matches the server pinned vector`() {
        assertEquals(
            "UkAvAJYvJMZg2YwnrmEJU958ycebRjwq-tR0Fxs6at8",
            IntegrityRequestHash.compute("login", "nonce-1".toByteArray(Charsets.US_ASCII)),
        )
    }

    @Test
    fun `request hash is 43 url-safe characters`() {
        val hash = IntegrityRequestHash.compute("login", ByteArray(16) { 0xFF.toByte() })

        assertEquals(43, hash.length)
        assertTrue(hash.matches(Regex("^[A-Za-z0-9_-]+$")))
    }

    @Test
    fun `attest binds the token to the hash of the payload it sends`() = runTest {
        val hash = slot<String>()
        val request = slot<VerifyIntegrityTokenRequest>()
        coEvery { facade.requestIntegrityToken(capture(hash)) } returns Result.success("opaque-token")
        coEvery { client.verifyIntegrityToken(capture(request), any()) } returns
            ResponseMessage.Success(
                verifyIntegrityTokenResponse {
                    verified = true
                    deviceVerdicts += DeviceVerdict.DEVICE_VERDICT_MEETS_BASIC_INTEGRITY
                    deviceVerdicts += DeviceVerdict.DEVICE_VERDICT_MEETS_STRONG_INTEGRITY
                },
                emptyMap(),
                emptyMap(),
            )

        val result = attestor.attest()

        assertEquals(DeviceAttestation(true, "", "meets_strong_integrity"), result)
        assertEquals("login", request.captured.action)
        assertEquals("opaque-token", request.captured.integrityToken)
        assertEquals("com.aedst.android", request.captured.packageName)
        assertEquals(16, request.captured.payload.size())
        assertEquals(hash.captured, request.captured.requestHash)
        assertEquals(IntegrityRequestHash.compute("login", request.captured.payload.toByteArray()), hash.captured)
    }

    @Test
    fun `a rejected token is a normal result with a reason`() = runTest {
        coEvery { facade.requestIntegrityToken(any()) } returns Result.success("t")
        coEvery { client.verifyIntegrityToken(any(), any()) } returns
            ResponseMessage.Success(
                verifyIntegrityTokenResponse {
                    verified = false
                    reason = FailureReason.FAILURE_REASON_DEVICE_NOT_TRUSTED
                },
                emptyMap(),
                emptyMap(),
            )

        assertEquals(DeviceAttestation(false, "device_not_trusted", ""), attestor.attest())
    }

    @Test
    fun `a facade failure is thrown and no RPC is made`() = runTest {
        coEvery { facade.requestIntegrityToken(any()) } returns Result.failure(IllegalStateException("no project"))

        val thrown = runCatching { attestor.attest() }.exceptionOrNull()

        assertTrue(thrown is IllegalStateException)
        coVerify(exactly = 0) { client.verifyIntegrityToken(any(), any()) }
    }

    @Test
    fun `server disabled surfaces as a failure`() = runTest {
        coEvery { facade.requestIntegrityToken(any()) } returns Result.success("t")
        coEvery { client.verifyIntegrityToken(any(), any()) } returns
            ResponseMessage.Failure(
                ConnectException(Code.FAILED_PRECONDITION, message = "disabled"),
                emptyMap(),
                emptyMap(),
            )

        assertTrue(runCatching { attestor.attest() }.isFailure)
    }

    // --- SignInAttestation: fire-and-forget, informational ---

    // runCurrent, not advanceUntilIdle: the latter returns once only background-scope work is left.
    private class Fixture(attestor: DeviceAttestor) {
        val scope = TestScope(StandardTestDispatcher())
        val analytics: AnalyticsTracker = mockk(relaxed = true)
        val logger: Logger = mockk(relaxed = true)
        val signIn = SignInAttestation(
            AttestDeviceUseCase(attestor, FakeDispatcherProvider(StandardTestDispatcher(scope.testScheduler))),
            analytics,
            logger,
            scope.backgroundScope,
        )
    }

    @Test
    fun `onSignedIn returns immediately and reports only verdict fields`() {
        val fixture = Fixture { DeviceAttestation(false, "device_not_trusted", "meets_basic_integrity") }

        fixture.signIn.onSignedIn()
        verify(exactly = 0) { fixture.analytics.logEvent(any(), any()) }
        fixture.scope.testScheduler.runCurrent()

        verify {
            fixture.analytics.logEvent(
                "device_attestation",
                mapOf("verified" to false, "reason" to "device_not_trusted", "device" to "meets_basic_integrity"),
            )
        }
    }

    @Test
    fun `failures are swallowed and logged at debug`() {
        val fixture = Fixture { throw IllegalStateException("Play Integrity cloud project number is not configured") }

        fixture.signIn.onSignedIn()
        fixture.scope.testScheduler.runCurrent()

        verify(exactly = 0) { fixture.analytics.logEvent(any(), any()) }
        verify { fixture.logger.debug(any(), any()) }
    }

    @Test
    fun `a run in flight absorbs further triggers`() {
        val gate = CompletableDeferred<Unit>()
        var calls = 0
        val fixture = Fixture {
            calls++
            gate.await()
            DeviceAttestation(true, "", "")
        }

        fixture.signIn.onSignedIn()
        fixture.scope.testScheduler.runCurrent()
        fixture.signIn.onSignedIn()
        fixture.scope.testScheduler.runCurrent()
        assertEquals(1, calls)

        gate.complete(Unit)
        fixture.scope.testScheduler.runCurrent()
        fixture.signIn.onSignedIn()
        fixture.scope.testScheduler.runCurrent()
        assertEquals(2, calls)
    }
}
