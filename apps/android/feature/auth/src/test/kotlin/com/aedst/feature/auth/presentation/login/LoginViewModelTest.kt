package com.aedst.feature.auth.presentation.login

import androidx.lifecycle.SavedStateHandle
import app.cash.turbine.test
import com.aedst.core.analytics.NoOpAnalyticsTracker
import com.aedst.core.common.AedstError
import com.aedst.core.common.ErrorReporter
import com.aedst.core.common.Logger
import com.aedst.core.testing.FakeDispatcherProvider
import com.aedst.core.testing.MainDispatcherExtension
import com.aedst.feature.auth.domain.model.AuthSession
import com.aedst.feature.auth.domain.model.AuthorizationCallback
import com.aedst.feature.auth.domain.model.AuthorizationLaunch
import com.aedst.feature.auth.domain.model.BeginSignInResult
import com.aedst.feature.auth.domain.model.SignInResult
import com.aedst.feature.auth.domain.repository.AuthRepository
import com.aedst.feature.auth.domain.usecase.BeginSignInUseCase
import com.aedst.feature.auth.domain.usecase.CompleteSignInUseCase
import com.aedst.feature.auth.presentation.SignInDiagnostics
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import io.mockk.verify
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertSame
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.extension.RegisterExtension
import java.util.Optional

class LoginViewModelTest {

    @JvmField
    @RegisterExtension
    val mainDispatcherRule = MainDispatcherExtension()

    private val launch = AuthorizationLaunch("browser-intent")
    private val callback = AuthorizationCallback("result-intent")
    private val signedInSession = AuthSession("u1", "access", "refresh", 0L)
    private val authRepository: AuthRepository = mockk {
        every { isSignInConfigured } returns true
        coEvery { beginSignIn() } returns BeginSignInResult.Ready(launch)
        coEvery { completeSignIn(any()) } returns SignInResult.SignedIn(signedInSession)
    }
    private val savedState = SavedStateHandle()
    private val logger: Logger = mockk(relaxed = true)
    private val reporter: ErrorReporter = mockk(relaxed = true)

    private fun viewModel(): LoginViewModel {
        val dispatchers = FakeDispatcherProvider(mainDispatcherRule.testDispatcher)
        return LoginViewModel(
            BeginSignInUseCase(authRepository, dispatchers),
            CompleteSignInUseCase(authRepository, dispatchers),
            authRepository,
            NoOpAnalyticsTracker(),
            savedState,
            SignInDiagnostics(logger, Optional.of(reporter)),
        )
    }

    private fun idle() = mainDispatcherRule.testDispatcher.scheduler.advanceUntilIdle()

    @Test
    fun `SignIn asks the UI to launch the browser with the prepared request`() = runTest {
        val viewModel = viewModel()

        viewModel.effects.test {
            viewModel.onIntent(LoginIntent.SignIn)
            idle()
            assertSame(launch, (awaitItem() as LoginEffect.LaunchBrowser).launch)
        }
        assertFalse(viewModel.state.value.isLoading)
    }

    @Test
    fun `a returned authorization is exchanged and navigates home`() = runTest {
        val viewModel = viewModel()
        viewModel.effects.test {
            viewModel.onIntent(LoginIntent.SignIn)
            idle()
            awaitItem() // LaunchBrowser

            viewModel.onIntent(LoginIntent.AuthorizationReturned(callback))
            idle()

            assertEquals(LoginEffect.NavigateToHome, awaitItem())
        }
        coVerify { authRepository.completeSignIn(callback) }
        assertFalse(viewModel.state.value.isLoading)
        assertNull(viewModel.state.value.problem)
    }

    @Test
    fun `a cancelled browser returns to idle without an error`() = runTest {
        coEvery { authRepository.completeSignIn(any()) } returns SignInResult.Cancelled
        val viewModel = viewModel()
        viewModel.onIntent(LoginIntent.SignIn)
        idle()

        viewModel.onIntent(LoginIntent.AuthorizationReturned(callback))
        idle()

        assertNull(viewModel.state.value.problem)
        assertFalse(viewModel.state.value.isLoading)
    }

    @Test
    fun `an exchange failure is exposed as an error kind in state, not as text`() = runTest {
        coEvery { authRepository.completeSignIn(any()) } throws AedstError.Forbidden()
        val viewModel = viewModel()
        viewModel.onIntent(LoginIntent.SignIn)
        idle()

        viewModel.onIntent(LoginIntent.AuthorizationReturned(callback))
        idle()

        val problem = viewModel.state.value.problem as LoginProblem.Failed
        assertTrue(problem.error is AedstError.Forbidden)
        assertFalse(viewModel.state.value.isLoading)
    }

    @Test
    fun `a failed sign-in logs the diagnostic message and reports a bug-like error as a non-fatal`() = runTest {
        val bug = AedstError.Unknown("The IdP issued no refresh token")
        coEvery { authRepository.completeSignIn(any()) } throws bug
        val viewModel = viewModel()
        viewModel.onIntent(LoginIntent.SignIn)
        idle()

        viewModel.onIntent(LoginIntent.AuthorizationReturned(callback))
        idle()

        verify { logger.warn(any(), match { it.contains("The IdP issued no refresh token") }, bug) }
        verify(exactly = 1) { reporter.recordNonFatal(bug) }
    }

    @Test
    fun `an expected failure is logged but not reported`() = runTest {
        coEvery { authRepository.beginSignIn() } throws AedstError.Offline()
        val viewModel = viewModel()

        viewModel.onIntent(LoginIntent.SignIn)
        idle()

        verify { logger.warn(any(), any(), any()) }
        verify(exactly = 0) { reporter.recordNonFatal(any()) }
    }

    @Test
    fun `a discovery failure is shown and no browser is launched`() = runTest {
        coEvery { authRepository.beginSignIn() } throws AedstError.Offline()
        val viewModel = viewModel()

        viewModel.effects.test {
            viewModel.onIntent(LoginIntent.SignIn)
            idle()
            expectNoEvents()
        }
        assertTrue((viewModel.state.value.problem as LoginProblem.Failed).error is AedstError.Offline)
    }

    @Test
    fun `a missing browser is reported as NoBrowser`() = runTest {
        coEvery { authRepository.beginSignIn() } returns BeginSignInResult.NoBrowser
        val viewModel = viewModel()

        viewModel.onIntent(LoginIntent.SignIn)
        idle()

        assertEquals(LoginProblem.NoBrowser, viewModel.state.value.problem)
    }

    @Test
    fun `the system refusing to start the browser is reported as NoBrowser and drops the pending flow`() = runTest {
        val viewModel = viewModel()
        viewModel.onIntent(LoginIntent.SignIn)
        idle()

        viewModel.onIntent(LoginIntent.BrowserUnavailable)
        viewModel.onIntent(LoginIntent.AuthorizationReturned(callback))
        idle()

        assertEquals(LoginProblem.NoBrowser, viewModel.state.value.problem)
        coVerify(exactly = 0) { authRepository.completeSignIn(any()) }
    }

    @Test
    fun `an unconfigured build shows NotConfigured and never starts a flow`() = runTest {
        every { authRepository.isSignInConfigured } returns false
        val viewModel = viewModel()

        viewModel.onIntent(LoginIntent.SignIn)
        idle()

        assertEquals(LoginProblem.NotConfigured, viewModel.state.value.problem)
        coVerify(exactly = 0) { authRepository.beginSignIn() }
    }

    @Test
    fun `a second SignIn while discovery is running is ignored`() = runTest {
        val gate = CompletableDeferred<BeginSignInResult>()
        coEvery { authRepository.beginSignIn() } coAnswers { gate.await() }
        val viewModel = viewModel()

        viewModel.onIntent(LoginIntent.SignIn)
        viewModel.onIntent(LoginIntent.SignIn)
        idle()
        assertTrue(viewModel.state.value.isLoading)
        gate.complete(BeginSignInResult.Ready(launch))
        idle()

        coVerify(exactly = 1) { authRepository.beginSignIn() }
    }

    @Test
    fun `a result nobody asked for is ignored`() = runTest {
        val viewModel = viewModel()

        viewModel.onIntent(LoginIntent.AuthorizationReturned(callback))
        idle()

        coVerify(exactly = 0) { authRepository.completeSignIn(any()) }
        assertFalse(viewModel.state.value.isLoading)
    }

    @Test
    fun `a result is accepted by a recreated view model after process death`() = runTest {
        val before = viewModel()
        before.onIntent(LoginIntent.SignIn)
        idle()
        // Process death: only the SavedStateHandle content survives; the new view model gets it back.
        val after = viewModel()

        after.effects.test {
            after.onIntent(LoginIntent.AuthorizationReturned(callback))
            idle()
            assertEquals(LoginEffect.NavigateToHome, awaitItem())
        }
    }

    @Test
    fun `the same result is not exchanged twice`() = runTest {
        val viewModel = viewModel()
        viewModel.onIntent(LoginIntent.SignIn)
        idle()

        viewModel.onIntent(LoginIntent.AuthorizationReturned(callback))
        viewModel.onIntent(LoginIntent.AuthorizationReturned(callback))
        idle()

        coVerify(exactly = 1) { authRepository.completeSignIn(any()) }
    }
}
