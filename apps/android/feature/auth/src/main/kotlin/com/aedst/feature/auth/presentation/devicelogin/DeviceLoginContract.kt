package com.aedst.feature.auth.presentation.devicelogin

import com.aedst.core.common.AedstError

/**
 * MVI contract of the TV sign-in screen (OAuth device flow, RFC 8628). State carries kinds and raw values, never
 * rendered strings: the UI localizes. The flow starts by itself when the screen opens, so there is no idle state.
 */
sealed interface DeviceLoginState {
    /** Asking the IdP for a code (discovery + device authorization request). */
    data object Requesting : DeviceLoginState

    /** The code is on screen and the app polls; [remainingSeconds] counts down to expiry. */
    data class WaitingForUser(
        val userCode: String,
        val verificationUri: String,
        val verificationUriComplete: String?,
        val remainingSeconds: Long,
    ) : DeviceLoginState

    /** Approved; the session is stored and [DeviceLoginEffect.NavigateToHome] is on its way. */
    data object Success : DeviceLoginState

    data class Failed(val problem: DeviceLoginProblem) : DeviceLoginState
}

sealed interface DeviceLoginProblem {
    data object NotConfigured : DeviceLoginProblem

    /** The user rejected the request on their phone. */
    data object Denied : DeviceLoginProblem

    /** The code was not approved in time. */
    data object Expired : DeviceLoginProblem

    data class Failed(val error: AedstError) : DeviceLoginProblem
}

sealed interface DeviceLoginIntent {
    /** The "Get a new code" button: cancels any running poll and starts over. */
    data object GetNewCode : DeviceLoginIntent
}

sealed interface DeviceLoginEffect {
    data object NavigateToHome : DeviceLoginEffect
}
