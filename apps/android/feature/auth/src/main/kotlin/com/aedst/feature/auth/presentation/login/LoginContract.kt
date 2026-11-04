package com.aedst.feature.auth.presentation.login

import com.aedst.core.common.AedstError
import com.aedst.feature.auth.domain.model.AuthorizationCallback
import com.aedst.feature.auth.domain.model.AuthorizationLaunch

/**
 * MVI contract: State is the single source of render truth, Intent is every user action or platform result, Effect
 * is one-shot (navigation, launching the browser). Problems live in State only — they are rendered on the screen
 * and must survive rotation, so they are not one-shot effects. State carries the problem *kind*, never a
 * pre-rendered string: the UI localizes it.
 */
data class LoginState(
    /** Discovery or the code exchange is running. The sign-in button is disabled and shows progress. */
    val isLoading: Boolean = false,
    val problem: LoginProblem? = null,
)

sealed interface LoginProblem {
    /** No issuer or client id in this build (see `feature/auth/build.gradle.kts`). The button is disabled. */
    data object NotConfigured : LoginProblem

    /** No browser installed or enabled that can show the IdP's hosted login. */
    data object NoBrowser : LoginProblem

    data class Failed(val error: AedstError) : LoginProblem
}

sealed interface LoginIntent {
    data object SignIn : LoginIntent

    /** The browser round trip ended; [callback] is the platform result (opaque to the view model). */
    data class AuthorizationReturned(val callback: AuthorizationCallback) : LoginIntent

    /** The system refused to start the browser activity. */
    data object BrowserUnavailable : LoginIntent
}

sealed interface LoginEffect {
    data object NavigateToHome : LoginEffect

    /** Ask the Compose layer to start the browser activity (it owns the `ActivityResultLauncher`). */
    data class LaunchBrowser(val launch: AuthorizationLaunch) : LoginEffect
}
