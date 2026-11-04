package com.aedst.feature.auth.presentation.login

import android.content.Context
import android.content.Intent
import androidx.activity.result.contract.ActivityResultContract
import com.aedst.feature.auth.domain.model.AuthorizationCallback
import com.aedst.feature.auth.domain.model.AuthorizationLaunch

/**
 * Starts AppAuth's `AuthorizationManagementActivity` (the intent the data layer prepared) for a result and wraps the
 * result `Intent` back into the opaque domain type. The only place in `presentation/` that knows the payloads are
 * Android Intents, so the view model and the domain stay platform-free.
 */
internal class AuthorizationActivityContract : ActivityResultContract<AuthorizationLaunch, AuthorizationCallback>() {
    override fun createIntent(context: Context, input: AuthorizationLaunch): Intent = input.platformIntent as Intent

    // A cancelled/killed browser delivers a null or empty Intent; the data layer maps that to "cancelled".
    override fun parseResult(resultCode: Int, intent: Intent?): AuthorizationCallback = AuthorizationCallback(intent)
}
