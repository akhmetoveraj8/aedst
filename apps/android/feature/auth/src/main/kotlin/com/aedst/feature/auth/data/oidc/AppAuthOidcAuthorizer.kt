package com.aedst.feature.auth.data.oidc

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import androidx.browser.customtabs.CustomTabsIntent
import androidx.core.net.toUri
import com.aedst.core.common.AedstError
import com.aedst.core.common.DispatcherProvider
import com.aedst.feature.auth.domain.model.AuthorizationCallback
import com.aedst.feature.auth.domain.model.AuthorizationLaunch
import com.aedst.feature.auth.domain.model.OidcTokens
import com.aedst.feature.auth.domain.repository.OidcAuthorizer
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import net.openid.appauth.AppAuthConfiguration
import net.openid.appauth.AuthorizationException
import net.openid.appauth.AuthorizationException.GeneralErrors
import net.openid.appauth.AuthorizationRequest
import net.openid.appauth.AuthorizationResponse
import net.openid.appauth.AuthorizationService
import net.openid.appauth.GrantTypeValues
import net.openid.appauth.NoClientAuthentication
import net.openid.appauth.ResponseTypeValues
import net.openid.appauth.TokenRequest
import net.openid.appauth.TokenResponse
import java.time.Clock
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * [OidcAuthorizer] on AppAuth-Android 0.11.1: Authorization Code + PKCE in the system browser (a Custom Tab where
 * the default browser supports it, otherwise a regular browser — never a WebView, RFC 8252).
 *
 * What AppAuth gives us (verified in its 0.11.1 sources): [AuthorizationRequest.Builder] always generates `state`,
 * `nonce` and a PKCE code verifier whose challenge method is S256 (`plain` only if SHA-256 were missing, which is
 * asserted against below). `AuthorizationManagementActivity` rejects a redirect whose `state` differs from the
 * request's, and a token response's ID token is validated (issuer = discovery issuer, audience contains the client id,
 * expiry, issued-at within 10 min, nonce on code exchange) before a [TokenResponse] is delivered.
 *
 * Process death: the in-flight [AuthorizationRequest] (verifier included) lives in `AuthorizationManagementActivity`
 * saved instance state and is echoed back inside the result `Intent`, so [redeem] needs no state of its own; a stale
 * or foreign result simply fails `state` validation inside AppAuth.
 *
 * An [AuthorizationService] is created per operation and disposed in `finally`: its constructor binds the browser's
 * Custom Tabs service, which must not outlive the operation. Token-only operations use a matcher that selects no
 * browser, so they never bind anything.
 */
@Singleton
class AppAuthOidcAuthorizer @Inject constructor(
    @ApplicationContext private val context: Context,
    private val config: OidcConfig,
    private val discovery: OidcDiscovery,
    private val dispatchers: DispatcherProvider,
    private val clock: Clock,
) : OidcAuthorizer {

    override val isConfigured: Boolean get() = config.isConfigured

    private val connectionBuilder = OidcConnectionBuilder(config.allowCleartextIssuer)

    private val browserConfiguration: AppAuthConfiguration = AppAuthConfiguration.Builder()
        .setConnectionBuilder(connectionBuilder)
        .setSkipIssuerHttpsCheck(config.allowCleartextIssuer)
        .build()

    /** No browser selected: a service built from this never binds Custom Tabs, it only performs token requests. */
    private val tokenConfiguration: AppAuthConfiguration = AppAuthConfiguration.Builder()
        .setConnectionBuilder(connectionBuilder)
        .setSkipIssuerHttpsCheck(config.allowCleartextIssuer)
        .setBrowserMatcher { false }
        .build()

    override suspend fun createAuthorization(): AuthorizationLaunch? {
        val configuration = discovery.configuration()
        val request = AuthorizationRequest.Builder(
            configuration,
            config.clientId,
            ResponseTypeValues.CODE,
            config.redirectUri.toUri(),
        )
            .setScopes(config.scopes)
            // A sign-out in the app does not end the IdP's browser session; select_account makes the user pick an
            // account (or another one) instead of being signed straight back in. See apps/android/README.md.
            .setPrompt(AuthorizationRequest.Prompt.SELECT_ACCOUNT)
            .build()
        check(request.codeVerifierChallengeMethod == AuthorizationRequest.CODE_CHALLENGE_METHOD_S256) {
            "PKCE S256 is unavailable on this device"
        }
        check(!request.state.isNullOrEmpty() && !request.nonce.isNullOrEmpty()) { "state/nonce were not generated" }

        // No CustomTabsSession (no warm-up): the intent stays valid after the service is disposed below.
        val customTab = CustomTabsIntent.Builder().setShowTitle(true).build()
        return withContext(dispatchers.io) {
            val service = AuthorizationService(context, browserConfiguration)
            try {
                AuthorizationLaunch(service.getAuthorizationRequestIntent(request, customTab))
            } catch (@Suppress("SwallowedException") noBrowser: ActivityNotFoundException) {
                null
            } finally {
                service.dispose()
            }
        }
    }

    override suspend fun redeem(callback: AuthorizationCallback): OidcTokens? {
        val data = callback.platformIntent as? Intent ?: return null
        val exception = readException(data)
        if (exception != null) {
            if (exception.isUserCancellation()) return null
            throw exception.toSignInError()
        }
        val response = readResponse(data) ?: return null
        val exchange = try {
            response.createTokenExchangeRequest()
        } catch (@Suppress("SwallowedException") missingCode: IllegalStateException) {
            throw AedstError.Unauthenticated("Authorization response carried no code")
        }
        return execute(exchange).toOidcTokens(clock)
    }

    override suspend fun refresh(refreshToken: String): OidcTokens {
        val request = TokenRequest.Builder(discovery.configuration(), config.clientId)
            .setGrantType(GrantTypeValues.REFRESH_TOKEN)
            .setRefreshToken(refreshToken)
            .build()
        return execute(request).toOidcTokens(clock)
    }

    private fun readException(data: Intent): AuthorizationException? = try {
        AuthorizationException.fromIntent(data)
    } catch (@Suppress("SwallowedException") malformed: IllegalArgumentException) {
        throw AedstError.Unknown("Malformed authorization result")
    }

    private fun readResponse(data: Intent): AuthorizationResponse? = try {
        AuthorizationResponse.fromIntent(data)
    } catch (@Suppress("SwallowedException") malformed: IllegalArgumentException) {
        throw AedstError.Unknown("Malformed authorization result")
    }

    /** One token endpoint call (public client: `client_id` only, no secret). */
    private suspend fun execute(request: TokenRequest): TokenResponse {
        val service = AuthorizationService(context, tokenConfiguration)
        try {
            return suspendCancellableCoroutine { continuation ->
                service.performTokenRequest(request, NoClientAuthentication.INSTANCE) { response, exception ->
                    if (response != null) {
                        continuation.resume(response)
                    } else {
                        continuation.resumeWithException(
                            tokenError(request, exception) ?: AedstError.Unknown("Token request failed"),
                        )
                    }
                }
            }
        } finally {
            service.dispose()
        }
    }

    /**
     * An ID-token validation failure on a *refresh* (typically device clock skew beyond AppAuth's 10 minute window)
     * is not a revoked session: report it as transient so the refresher keeps the session instead of signing out.
     */
    private fun tokenError(request: TokenRequest, exception: AuthorizationException?): AedstError? {
        exception ?: return null
        val idTokenProblem = exception == GeneralErrors.ID_TOKEN_VALIDATION_ERROR ||
            exception == GeneralErrors.ID_TOKEN_PARSING_ERROR
        return if (request.grantType == GrantTypeValues.REFRESH_TOKEN && idTokenProblem) {
            AedstError.Unknown("ID token rejected during refresh (check the device clock)", exception)
        } else {
            exception.toSignInError()
        }
    }
}
