package com.aedst.feature.auth.presentation.account

import app.cash.turbine.test
import com.aedst.core.analytics.AnalyticsConsentState
import com.aedst.core.analytics.AnalyticsConsentStore
import com.aedst.core.analytics.NoOpAnalyticsTracker
import com.aedst.core.testing.FakeDispatcherProvider
import com.aedst.core.testing.MainDispatcherExtension
import com.aedst.feature.auth.domain.model.AuthSession
import com.aedst.feature.auth.domain.repository.AuthRepository
import com.aedst.feature.auth.domain.usecase.LogoutUseCase
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.extension.RegisterExtension

class AccountViewModelTest {

    @JvmField
    @RegisterExtension
    val mainDispatcherRule = MainDispatcherExtension()

    private val sessionFlow = MutableStateFlow<AuthSession?>(AuthSession("u1", "access", "refresh", 0L))
    private val authRepository: AuthRepository = mockk {
        every { session } returns sessionFlow
        coEvery { logout() } returns Unit
    }
    private val consentStore = object : AnalyticsConsentStore {
        override val consent = MutableStateFlow(AnalyticsConsentState.UNSET)
        override suspend fun setConsent(granted: Boolean) {
            consent.value = if (granted) AnalyticsConsentState.GRANTED else AnalyticsConsentState.DENIED
        }
    }

    // Lazy: viewModelScope binds to Dispatchers.Main when the ViewModel is built, which must be after the rule
    // has installed the test dispatcher (field initialisers run before the rule starts).
    private val viewModel by lazy {
        AccountViewModel(
            authRepository,
            LogoutUseCase(authRepository, FakeDispatcherProvider(mainDispatcherRule.testDispatcher)),
            NoOpAnalyticsTracker(),
            consentStore,
        )
    }

    @Test
    fun `exposes the signed-in user id and the consent choice in one state`() = runTest {
        viewModel.state.test {
            assertEquals(AccountState(), awaitItem()) // initial, before the flows are collected
            val signedIn = awaitItem()
            assertEquals("u1", signedIn.userId)
            assertFalse(signedIn.isAnalyticsEnabled)

            viewModel.onIntent(AccountIntent.SetAnalyticsEnabled(true))
            mainDispatcherRule.testDispatcher.scheduler.advanceUntilIdle()
            assertEquals(AccountState("u1", isSigningOut = false, isAnalyticsEnabled = true), awaitItem())
        }
    }

    @Test
    fun `signOut calls logout once and finishes not-signing-out`() = runTest {
        viewModel.onIntent(AccountIntent.SignOut)
        viewModel.onIntent(AccountIntent.SignOut) // double tap while in flight
        mainDispatcherRule.testDispatcher.scheduler.advanceUntilIdle()

        coVerify(exactly = 1) { authRepository.logout() }
        viewModel.state.test {
            // The last emitted state is not signing out.
            assertFalse(expectMostRecentItem().isSigningOut)
        }
    }
}
