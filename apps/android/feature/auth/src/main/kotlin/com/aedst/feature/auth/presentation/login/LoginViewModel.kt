package com.aedst.feature.auth.presentation.login

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.aedst.core.analytics.AnalyticsTracker
import com.aedst.core.common.Outcome
import com.aedst.feature.auth.domain.model.AuthorizationCallback
import com.aedst.feature.auth.domain.model.BeginSignInResult
import com.aedst.feature.auth.domain.model.SignInResult
import com.aedst.feature.auth.domain.repository.AuthRepository
import com.aedst.feature.auth.domain.usecase.BeginSignInUseCase
import com.aedst.feature.auth.domain.usecase.CompleteSignInUseCase
import com.aedst.feature.auth.presentation.SignInDiagnostics
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * UDF loop: intents flow in via [onIntent], state flows out via [state] for `collectAsStateWithLifecycle`, one-shot
 * events (open the browser, navigate home) flow out via [effects] (a Channel, not a StateFlow, so they are never
 * replayed).
 *
 * Sign-in is two steps around a browser round trip the Compose layer performs: [LoginIntent.SignIn] prepares the
 * request and emits [LoginEffect.LaunchBrowser]; [LoginIntent.AuthorizationReturned] carries the result back.
 * Whether a browser round trip is in flight is kept in [SavedStateHandle], so after process death (the browser can
 * outlive the app process) the delivered result is still accepted, while a result nobody asked for is ignored. The
 * view model never touches an `Intent`: the launch/callback payloads are opaque domain values.
 */
@HiltViewModel
internal class LoginViewModel @Inject constructor(
    private val beginSignIn: BeginSignInUseCase,
    private val completeSignIn: CompleteSignInUseCase,
    authRepository: AuthRepository,
    private val analyticsTracker: AnalyticsTracker,
    private val savedState: SavedStateHandle,
    private val diagnostics: SignInDiagnostics,
) : ViewModel() {

    private val mutableState = MutableStateFlow(
        LoginState(problem = if (authRepository.isSignInConfigured) null else LoginProblem.NotConfigured),
    )
    val state: StateFlow<LoginState> = mutableState.asStateFlow()

    private val effectChannel = Channel<LoginEffect>(Channel.BUFFERED)
    val effects = effectChannel.receiveAsFlow()

    fun onIntent(intent: LoginIntent) {
        when (intent) {
            LoginIntent.SignIn -> signIn()
            is LoginIntent.AuthorizationReturned -> authorizationReturned(intent.callback)
            LoginIntent.BrowserUnavailable -> {
                savedState[KEY_BROWSER_PENDING] = false
                mutableState.update { it.copy(isLoading = false, problem = LoginProblem.NoBrowser) }
            }
        }
    }

    private fun signIn() {
        val current = mutableState.value
        // Ignore double taps, and a second flow while discovery or a code exchange is running.
        if (current.isLoading || current.problem == LoginProblem.NotConfigured) return

        mutableState.update { it.copy(isLoading = true, problem = null) }
        viewModelScope.launch {
            when (val outcome = beginSignIn()) {
                is Outcome.Success -> when (val result = outcome.value) {
                    is BeginSignInResult.Ready -> {
                        savedState[KEY_BROWSER_PENDING] = true
                        mutableState.update { it.copy(isLoading = false) }
                        effectChannel.send(LoginEffect.LaunchBrowser(result.launch))
                    }
                    BeginSignInResult.NoBrowser ->
                        mutableState.update { it.copy(isLoading = false, problem = LoginProblem.NoBrowser) }
                    BeginSignInResult.NotConfigured ->
                        mutableState.update { it.copy(isLoading = false, problem = LoginProblem.NotConfigured) }
                }
                is Outcome.Failure -> fail(outcome)
            }
        }
    }

    private fun authorizationReturned(callback: AuthorizationCallback) {
        // Only accept a result for a flow this screen started (survives process death via SavedStateHandle).
        if (savedState.get<Boolean>(KEY_BROWSER_PENDING) != true || mutableState.value.isLoading) return
        savedState[KEY_BROWSER_PENDING] = false

        mutableState.update { it.copy(isLoading = true, problem = null) }
        viewModelScope.launch {
            when (val outcome = completeSignIn(callback)) {
                is Outcome.Success -> when (outcome.value) {
                    is SignInResult.SignedIn -> {
                        analyticsTracker.logEvent("login_success")
                        mutableState.update { it.copy(isLoading = false) }
                        effectChannel.send(LoginEffect.NavigateToHome)
                    }
                    SignInResult.Cancelled -> {
                        analyticsTracker.logEvent("login_cancelled")
                        mutableState.update { it.copy(isLoading = false) }
                    }
                }
                is Outcome.Failure -> fail(outcome)
            }
        }
    }

    private fun fail(failure: Outcome.Failure) {
        // Analytics gets the failure *kind* only (the message may echo IdP detail); the developer diagnostics carry it.
        diagnostics.failed("browser", failure.error)
        analyticsTracker.logEvent("login_failure", mapOf("reason" to failure.error::class.simpleName))
        mutableState.update { it.copy(isLoading = false, problem = LoginProblem.Failed(failure.error)) }
    }

    private companion object {
        const val KEY_BROWSER_PENDING = "browser_pending"
    }
}
