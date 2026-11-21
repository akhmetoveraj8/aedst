package com.aedst.feature.auth.domain

/**
 * The OIDC client operations feature/auth needs, behind an interface so everything above `data/oidc` (repository,
 * refresher, view models) is tested with a fake and never sees AppAuth. Failures are thrown as `AedstError`;
 * `Unauthenticated` from [refresh] means the IdP definitively rejected the refresh token (`invalid_grant`).
 */
public interface OidcAuthorizer {
    public val isConfigured: Boolean

    /** Discovery + authorization request (PKCE S256, state, nonce). Null when no browser can handle it. */
    public suspend fun createAuthorization(): AuthorizationLaunch?

    /** Validates the browser result and exchanges the code. Null when the user cancelled. */
    public suspend fun redeem(callback: AuthorizationCallback): OidcTokens?

    /** OIDC `refresh_token` grant. The returned refresh token (if any) replaces the old one. */
    public suspend fun refresh(refreshToken: String): OidcTokens
}

/** RFC 7009 token revocation. Best effort: callers must not let a failure block sign-out. */
public fun interface TokenRevoker {
    public suspend fun revoke(refreshToken: String)
}
