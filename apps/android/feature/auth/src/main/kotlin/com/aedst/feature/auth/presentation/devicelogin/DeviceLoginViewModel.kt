package com.aedst.feature.auth.presentation.devicelogin

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.aedst.core.analytics.AnalyticsTracker
import com.aedst.core.common.Outcome
import com.aedst.feature.auth.domain.model.DeviceAuthorization
import com.aedst.feature.auth.domain.model.DeviceSignInResult
import com.aedst.feature.auth.domain.repository.AuthRepository
import com.aedst.feature.auth.domain.usecase.AwaitDeviceSignInUseCase
import com.aedst.feature.auth.domain.usecase.BeginDeviceSignInUseCase
import com.aedst.feature.auth.presentation.SignInDiagnostics
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Runs the device flow: on creation (and on [DeviceLoginIntent.GetNewCode]) requests a code, shows it, polls in the
 * background while a one-second ticker counts the remaining time down, and navigates home once approved. The poll
 * lives in [viewModelScope], so leaving the screen cancels it (and its HTTP call).
 *
 * The device code is never part of the state; only what the user must see is.
 */
@HiltViewModel
internal class DeviceLoginViewModel @Inject constructor(
    private val beginDeviceSignIn: BeginDeviceSignInUseCase,
    private val awaitDeviceSignIn: AwaitDeviceSignInUseCase,
    private val authRepository: AuthRepository,
    private val analyticsTracker: AnalyticsTracker,
    private val diagnostics: SignInDiagnostics,
) : ViewModel() {

    private val mutableState = MutableStateFlow<DeviceLoginState>(DeviceLoginState.Requesting)
    val state: StateFlow<DeviceLoginState> = mutableState.asStateFlow()

    private val effectChannel = Channel<DeviceLoginEffect>(Channel.BUFFERED)
    val effects = effectChannel.receiveAsFlow()

    private var flowJob: Job? = null

    init {
        start()
    }

    fun onIntent(intent: DeviceLoginIntent) {
        when (intent) {
            DeviceLoginIntent.GetNewCode -> start()
        }
    }

    private fun start() {
        flowJob?.cancel()
        if (!authRepository.isSignInConfigured) {
            mutableState.value = DeviceLoginState.Failed(DeviceLoginProblem.NotConfigured)
            return
        }
        mutableState.value = DeviceLoginState.Requesting
        flowJob = viewModelScope.launch {
            val authorization = when (val outcome = beginDeviceSignIn()) {
                is Outcome.Success -> outcome.value
                is Outcome.Failure -> return@launch fail(outcome)
            }
            mutableState.value = DeviceLoginState.WaitingForUser(
                userCode = authorization.userCode,
                verificationUri = authorization.verificationUri,
                verificationUriComplete = authorization.verificationUriComplete,
                remainingSeconds = authorization.expiresInSeconds,
            )
            val ticker = launch { countDown(authorization) }
            val outcome = awaitDeviceSignIn(authorization)
            ticker.cancel()
            when (outcome) {
                is Outcome.Success -> finish(outcome.value)
                is Outcome.Failure -> fail(outcome)
            }
        }
    }

    private suspend fun countDown(authorization: DeviceAuthorization) {
        var remaining = authorization.expiresInSeconds
        while (remaining > 0) {
            delay(TICK_MILLIS)
            remaining--
            mutableState.update { current ->
                if (current is DeviceLoginState.WaitingForUser) current.copy(remainingSeconds = remaining) else current
            }
        }
    }

    private suspend fun finish(result: DeviceSignInResult) {
        when (result) {
            is DeviceSignInResult.SignedIn -> {
                analyticsTracker.logEvent("login_success", mapOf("method" to "device"))
                mutableState.value = DeviceLoginState.Success
                effectChannel.send(DeviceLoginEffect.NavigateToHome)
            }
            DeviceSignInResult.Denied ->
                mutableState.value = DeviceLoginState.Failed(DeviceLoginProblem.Denied)
            DeviceSignInResult.Expired ->
                mutableState.value = DeviceLoginState.Failed(DeviceLoginProblem.Expired)
        }
    }

    private fun fail(failure: Outcome.Failure) {
        // Analytics gets the failure *kind* only (the message may echo IdP detail); the developer diagnostics carry it.
        diagnostics.failed("device", failure.error)
        analyticsTracker.logEvent(
            "login_failure",
            mapOf("method" to "device", "reason" to failure.error::class.simpleName),
        )
        mutableState.value = DeviceLoginState.Failed(DeviceLoginProblem.Failed(failure.error))
    }

    private companion object {
        const val TICK_MILLIS = 1_000L
    }
}
