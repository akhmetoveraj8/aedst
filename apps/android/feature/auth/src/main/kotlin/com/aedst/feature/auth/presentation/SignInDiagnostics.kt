package com.aedst.feature.auth.presentation

import com.aedst.core.common.AedstError
import com.aedst.core.common.ErrorReporter
import com.aedst.core.common.Logger
import com.aedst.core.common.isReportable
import com.aedst.core.common.kind
import java.util.Optional
import javax.inject.Inject

/**
 * What a developer needs when a sign-in fails. The user sees only the localized message of the error *kind*; the
 * diagnostic text (`error.message`: the AppAuth type/code, `invalid_grant`, "the IdP issued no refresh token") goes to
 * logcat at warn level, and a failure that is a bug or a storage fault (`Unknown`, `Storage`) is also sent to the
 * crash reporter as a non-fatal. Expected states (offline, a denied request, a cancelled flow) are not reported:
 * they would only bury the real findings.
 *
 * The message never contains a token: AppAuth and the IdP return error codes, not credentials.
 */
internal class SignInDiagnostics @Inject constructor(
    private val logger: Logger,
    private val errorReporter: Optional<ErrorReporter>,
) {
    fun failed(method: String, error: AedstError) {
        logger.warn(TAG, "Sign-in ($method) failed: ${error.kind}: ${error.message}", error)
        if (error.isReportable) errorReporter.ifPresent { it.recordNonFatal(error) }
    }

    private companion object {
        const val TAG = "SignIn"
    }
}
