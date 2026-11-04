package com.aedst.feature.auth.data.oidc

import com.aedst.core.common.AedstError
import com.aedst.feature.auth.data.local.AccessTokenClaims
import com.aedst.feature.auth.domain.model.OidcTokens
import net.openid.appauth.TokenResponse
import java.time.Clock

/** Used only if the IdP omitted `expires_in` (ZITADEL always sends it): refresh again soon rather than never. */
private const val FALLBACK_ACCESS_TTL_SECONDS = 300L
private const val MILLIS_PER_SECOND = 1000L

internal fun TokenResponse.toOidcTokens(clock: Clock): OidcTokens = oidcTokensFrom(
    accessToken = accessToken,
    idToken = idToken,
    refreshToken = refreshToken,
    accessExpirationMillis = accessTokenExpirationTime,
    clock = clock,
)

/**
 * Pure part of the token-response mapping (no AppAuth types, so it is unit-tested on the plain JVM).
 *
 * The access token **must** be a JWT: the server verifies tokens offline and answers an opaque one with 401
 * (`auth.ErrOpaqueToken`), which would look like a login loop. Failing at sign-in with an actionable message
 * surfaces the misconfiguration (ZITADEL: application token type "JWT") immediately.
 */
internal fun oidcTokensFrom(
    accessToken: String?,
    idToken: String?,
    refreshToken: String?,
    accessExpirationMillis: Long?,
    clock: Clock,
): OidcTokens {
    val access = accessToken?.takeIf(String::isNotBlank)
        ?: throw AedstError.Unknown("Token response has no access token")
    if (!AccessTokenClaims.isJwt(access)) {
        throw AedstError.Unknown(
            "The IdP returned an opaque access token; set the application's access token type to JWT",
        )
    }
    return OidcTokens(
        accessToken = access,
        refreshToken = refreshToken?.takeIf(String::isNotBlank),
        accessExpiresAtEpochSeconds = accessExpirationMillis?.let { Math.floorDiv(it, MILLIS_PER_SECOND) }
            ?: (clock.instant().epochSecond + FALLBACK_ACCESS_TTL_SECONDS),
        subject = idToken?.let(AccessTokenClaims::subject) ?: AccessTokenClaims.subject(access),
    )
}
