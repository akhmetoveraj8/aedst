package com.aedst.feature.auth.domain.repository

import com.aedst.feature.auth.domain.model.AuthorizationCallback
import com.aedst.feature.auth.domain.model.AuthorizationLaunch
import com.aedst.feature.auth.domain.model.OidcTokens

/**
 * The OIDC client operations feature/auth needs, behind an interface so everything above `data/oidc` (repository,
 * refresher, view models) is tested with a fake and never sees AppAuth. Failures are thrown as `AedstError`;
 * `Unauthenticated` from [refresh] means the IdP definitively rejected the refresh token (`invalid_grant`).
 */
interface OidcAuthorizer {
    val isConfigured: Boolean

    /** Discovery + authorization request (PKCE S256, state, nonce). Null when no browser can handle it. */
    suspend fun createAuthorization(): AuthorizationLaunch?

    /** Validates the browser result and exchanges the code. Null when the user cancelled. */
    suspend fun redeem(callback: AuthorizationCallback): OidcTokens?

    /** OIDC `refresh_token` grant. The returned refresh token (if any) replaces the old one. */
    suspend fun refresh(refreshToken: String): OidcTokens
}

/** RFC 7009 token revocation. Best effort: callers must not let a failure block sign-out. */
fun interface TokenRevoker {
    suspend fun revoke(refreshToken: String)
}
