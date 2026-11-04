package com.aedst.feature.auth.data.oidc

import com.aedst.core.common.AedstError
import com.aedst.core.network.toAedstError
import net.openid.appauth.AuthorizationException
import net.openid.appauth.AuthorizationException.AuthorizationRequestErrors
import net.openid.appauth.AuthorizationException.GeneralErrors
import net.openid.appauth.AuthorizationException.TokenRequestErrors
import java.io.IOException

/**
 * The user backed out of the browser. This is not an error: the sign-in screen just returns to idle.
 * (`PROGRAM_CANCELED_AUTH_FLOW` is deliberately *not* here: AppAuth uses it when no browser could be started.)
 */
internal fun AuthorizationException.isUserCancellation(): Boolean = this == GeneralErrors.USER_CANCELED_AUTH_FLOW

/**
 * Maps an AppAuth failure to the app-wide [AedstError] taxonomy. The `message` is diagnostic only (type, code and the
 * OAuth `error` string — never tokens, codes or verifiers); the UI localizes by kind.
 *
 * | AppAuth | AedstError |
 * |---|---|
 * | network error (cause `UnknownHostException`) / (other I/O) | Offline / Network |
 * | server error, malformed discovery/token JSON | Network (captive portal, proxy, 5xx) |
 * | authorization `access_denied` | Forbidden |
 * | authorization `server_error`, `temporarily_unavailable` | Network |
 * | token `invalid_grant` (code or refresh token rejected) | Unauthenticated (definitive) |
 * | token `invalid_request` | Validation |
 * | ID token invalid, state mismatch | Unauthenticated |
 * | `invalid_client`, `unauthorized_client`, `invalid_scope`, unsupported types (misconfiguration) | Unknown |
 * | token endpoint `OTHER` (unrecognised error string, typically a 5xx body) | Network |
 */
internal fun AuthorizationException.toSignInError(): AedstError {
    val detail = "OIDC ${describe()}"
    return when (type) {
        AuthorizationException.TYPE_GENERAL_ERROR -> generalError(detail)
        AuthorizationException.TYPE_OAUTH_AUTHORIZATION_ERROR -> authorizationError(detail)
        AuthorizationException.TYPE_OAUTH_TOKEN_ERROR -> tokenError(detail)
        else -> AedstError.Unknown(detail, this)
    }
}

private fun AuthorizationException.generalError(detail: String): AedstError = when (this) {
    GeneralErrors.NETWORK_ERROR -> (cause as? IOException)?.toAedstError() ?: AedstError.Unavailable(detail, this)
    GeneralErrors.SERVER_ERROR,
    GeneralErrors.JSON_DESERIALIZATION_ERROR,
    GeneralErrors.INVALID_DISCOVERY_DOCUMENT,
    -> AedstError.Unavailable(detail, this)
    // Also AuthorizationRequestErrors.STATE_MISMATCH (same type/code).
    GeneralErrors.ID_TOKEN_VALIDATION_ERROR,
    GeneralErrors.ID_TOKEN_PARSING_ERROR,
    -> AedstError.Unauthenticated(detail)
    else -> AedstError.Unknown(detail, this)
}

private fun AuthorizationException.authorizationError(detail: String): AedstError = when (this) {
    AuthorizationRequestErrors.ACCESS_DENIED -> AedstError.Forbidden(detail)
    AuthorizationRequestErrors.SERVER_ERROR,
    AuthorizationRequestErrors.TEMPORARILY_UNAVAILABLE,
    -> AedstError.Unavailable(detail, this)
    else -> AedstError.Unknown(detail, this)
}

private fun AuthorizationException.tokenError(detail: String): AedstError = when (this) {
    TokenRequestErrors.INVALID_GRANT -> AedstError.Unauthenticated(detail)
    TokenRequestErrors.INVALID_REQUEST -> AedstError.InvalidInput(detail)
    TokenRequestErrors.OTHER -> AedstError.Unavailable(detail, this)
    else -> AedstError.Unknown(detail, this)
}

private fun AuthorizationException.describe(): String = "type=$type code=$code error=${error ?: "-"}"
