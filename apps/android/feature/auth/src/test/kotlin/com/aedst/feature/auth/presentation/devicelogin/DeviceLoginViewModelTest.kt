package com.aedst.feature.auth.presentation.devicelogin

import app.cash.turbine.test
import com.aedst.core.analytics.NoOpAnalyticsTracker
import com.aedst.core.common.AedstError
import com.aedst.core.common.ErrorReporter
import com.aedst.core.common.Logger
import com.aedst.core.testing.FakeDispatcherProvider
import com.aedst.core.testing.MainDispatcherExtension
import com.aedst.feature.auth.domain.model.AuthSession
import com.aedst.feature.auth.domain.model.DeviceAuthorization
import com.aedst.feature.auth.domain.model.DeviceSignInResult
import com.aedst.feature.auth.domain.repository.AuthRepository
import com.aedst.feature.auth.domain.usecase.AwaitDeviceSignInUseCase
import com.aedst.feature.auth.domain.usecase.BeginDeviceSignInUseCase
import com.aedst.feature.auth.presentation.SignInDiagnostics
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import io.mockk.verify
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.extension.RegisterExtension
import java.util.Optional

class DeviceLoginViewModelTest {

    @JvmField
    @RegisterExtension
    val mainDispatcherRule = MainDispatcherExtension()

    private val authorization =
        DeviceAuthorization("WDJB-MJHT", "https://idp/device", "https://idp/device?c=1", 300, 5, "dev-code")
    private val session = AuthSession("u1", "access", "refresh", 0L)
    private val gate = CompletableDeferred<DeviceSignInResult>()
    private val logger: Logger = mockk(relaxed = true)
    private val reporter: ErrorReporter = mockk(relaxed = true)
    private val authRepository: AuthRepository = mockk {
        every { isSignInConfigured } returns true
        coEvery { beginDeviceSignIn() } returns authorization
        coEvery { awaitDeviceSignIn(any()) } coAnswers { gate.await() }
    }

    private fun viewModel(): DeviceLoginViewModel {
        val dispatchers = FakeDispatcherProvider(mainDispatcherRule.testDispatcher)
        return DeviceLoginViewModel(
            BeginDeviceSignInUseCase(authRepository, dispatchers),
            AwaitDeviceSignInUseCase(authRepository, dispatchers),
            authRepository,
            NoOpAnalyticsTracker(),
            SignInDiagnostics(logger, Optional.of(reporter)),
        )
    }

    private val scheduler get() = mainDispatcherRule.testDispatcher.scheduler

    @Test
    fun `shows the code and counts the remaining time down while polling`() = runTest {
        val viewModel = viewModel()
        assertEquals(DeviceLoginState.Requesting, viewModel.state.value)

        scheduler.runCurrent()
        val waiting = viewModel.state.value as DeviceLoginState.WaitingForUser
        assertEquals("WDJB-MJHT", waiting.userCode)
        assertEquals("https://idp/device", waiting.verificationUri)
        assertEquals("https://idp/device?c=1", waiting.verificationUriComplete)
        assertEquals(300, waiting.remainingSeconds)

        scheduler.advanceTimeBy(3_000)
        scheduler.runCurrent()
        assertEquals(297, (viewModel.state.value as DeviceLoginState.WaitingForUser).remainingSeconds)
    }

    @Test
    fun `approval navigates home`() = runTest {
        val viewModel = viewModel()
        viewModel.effects.test {
            scheduler.runCurrent()
            gate.complete(DeviceSignInResult.SignedIn(session))
            scheduler.runCurrent()

            assertEquals(DeviceLoginEffect.NavigateToHome, awaitItem())
        }
        assertEquals(DeviceLoginState.Success, viewModel.state.value)
    }

    @Test
    fun `denied shows the Denied problem`() = runTest {
        val viewModel = viewModel()
        scheduler.runCurrent()
        gate.complete(DeviceSignInResult.Denied)
        scheduler.runCurrent()

        assertEquals(DeviceLoginState.Failed(DeviceLoginProblem.Denied), viewModel.state.value)
    }

    @Test
    fun `expired shows the Expired problem and stops the countdown`() = runTest {
        val viewModel = viewModel()
        scheduler.runCurrent()
        gate.complete(DeviceSignInResult.Expired)
        scheduler.runCurrent()
        scheduler.advanceTimeBy(5_000)
        scheduler.runCurrent()

        assertEquals(DeviceLoginState.Failed(DeviceLoginProblem.Expired), viewModel.state.value)
    }

    @Test
    fun `a request failure is exposed as an error kind`() = runTest {
        coEvery { authRepository.beginDeviceSignIn() } throws AedstError.Offline()
        val viewModel = viewModel()
        scheduler.runCurrent()

        val failed = viewModel.state.value as DeviceLoginState.Failed
        assertTrue((failed.problem as DeviceLoginProblem.Failed).error is AedstError.Offline)
        coVerify(exactly = 0) { authRepository.awaitDeviceSignIn(any()) }
    }

    @Test
    fun `a polling failure is exposed as an error kind`() = runTest {
        coEvery { authRepository.awaitDeviceSignIn(any()) } throws AedstError.Unknown("grant disabled")
        val viewModel = viewModel()
        scheduler.runCurrent()

        val failed = viewModel.state.value as DeviceLoginState.Failed
        assertTrue((failed.problem as DeviceLoginProblem.Failed).error is AedstError.Unknown)
    }

    @Test
    fun `a polling failure is logged with its diagnostic message and reported as a non-fatal`() = runTest {
        val bug = AedstError.Unknown("grant disabled")
        coEvery { authRepository.awaitDeviceSignIn(any()) } throws bug
        viewModel()
        scheduler.runCurrent()

        verify { logger.warn(any(), match { it.contains("grant disabled") }, bug) }
        verify(exactly = 1) { reporter.recordNonFatal(bug) }
    }

    @Test
    fun `an unconfigured build shows NotConfigured and requests nothing`() = runTest {
        every { authRepository.isSignInConfigured } returns false
        val viewModel = viewModel()
        scheduler.runCurrent()

        assertEquals(DeviceLoginState.Failed(DeviceLoginProblem.NotConfigured), viewModel.state.value)
        coVerify(exactly = 0) { authRepository.beginDeviceSignIn() }
    }

    @Test
    fun `get a new code cancels the running poll and starts over`() = runTest {
        val newAuthorization = DeviceAuthorization("NEW-CODE", "https://idp/device", null, 300, 5, "dev-2")
        val viewModel = viewModel()
        scheduler.runCurrent()

        coEvery { authRepository.beginDeviceSignIn() } returns newAuthorization
        coEvery { authRepository.awaitDeviceSignIn(any()) } coAnswers
            { CompletableDeferred<DeviceSignInResult>().await() }
        viewModel.onIntent(DeviceLoginIntent.GetNewCode)
        assertEquals(DeviceLoginState.Requesting, viewModel.state.value)
        scheduler.runCurrent()

        assertEquals("NEW-CODE", (viewModel.state.value as DeviceLoginState.WaitingForUser).userCode)
        // The first poll was cancelled, so a late approval of the old code cannot flip the state any more.
        gate.complete(DeviceSignInResult.Denied)
        scheduler.runCurrent()
        assertTrue(viewModel.state.value is DeviceLoginState.WaitingForUser)
    }
}
