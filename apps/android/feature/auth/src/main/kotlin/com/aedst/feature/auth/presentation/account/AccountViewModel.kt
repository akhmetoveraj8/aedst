package com.aedst.feature.auth.presentation.account

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.aedst.core.analytics.AnalyticsConsentState
import com.aedst.core.analytics.AnalyticsConsentStore
import com.aedst.core.analytics.AnalyticsTracker
import com.aedst.feature.auth.domain.repository.AuthRepository
import com.aedst.feature.auth.domain.usecase.LogoutUseCase
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class AccountState(
    val userId: String? = null,
    val isSigningOut: Boolean = false,
    /** Product analytics is opt-in (unset counts as "no"). */
    val isAnalyticsEnabled: Boolean = false,
)

sealed interface AccountIntent {
    data class SetAnalyticsEnabled(val enabled: Boolean) : AccountIntent
    data object SignOut : AccountIntent
}

/**
 * The state is derived from the session and the consent store plus the local "signing out" flag. There is no effect:
 * signing out clears the session, and `app/` resets every back stack and shows the login screen on its own.
 */
@HiltViewModel
internal class AccountViewModel @Inject constructor(
    authRepository: AuthRepository,
    private val logoutUseCase: LogoutUseCase,
    private val analyticsTracker: AnalyticsTracker,
    private val consentStore: AnalyticsConsentStore,
) : ViewModel() {

    private val signingOut = MutableStateFlow(false)

    val state: StateFlow<AccountState> = combine(
        authRepository.session.map { it?.userId },
        signingOut,
        consentStore.consent.map { it == AnalyticsConsentState.GRANTED },
    ) { userId, isSigningOut, isAnalyticsEnabled ->
        AccountState(userId, isSigningOut, isAnalyticsEnabled)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MS), AccountState())

    fun onIntent(intent: AccountIntent) {
        when (intent) {
            is AccountIntent.SetAnalyticsEnabled -> viewModelScope.launch { consentStore.setConsent(intent.enabled) }
            AccountIntent.SignOut -> signOut()
        }
    }

    private fun signOut() {
        if (signingOut.value) return
        signingOut.update { true }
        viewModelScope.launch {
            analyticsTracker.logEvent("logout")
            logoutUseCase()
            signingOut.update { false }
        }
    }

    private companion object {
        const val STOP_TIMEOUT_MS = 5_000L
    }
}
