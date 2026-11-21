package com.aedst.feature.auth.domain

import kotlinx.coroutines.flow.Flow

/**
 * Declared here (domain), implemented in `data/repository` — same rule as
 * the server's `application` package owning its repository interfaces
 * while `infrastructure/postgres` implements them.
 *
 * Sign-in is OIDC Authorization Code + PKCE in the system browser (RFC 8252), so it is two steps around a
 * browser round trip the UI performs: [beginSignIn] then, with what the browser returned, [completeSignIn].
 * Failures are thrown as `AedstError`.
 */
public interface AuthRepository {
    public val session: Flow<AuthSession?>

    /** Whether this build has an issuer and client id; when false [beginSignIn] returns `NotConfigured`. */
    public val isSignInConfigured: Boolean

    /** Discovers the IdP and prepares the browser launch. */
    public suspend fun beginSignIn(): BeginSignInResult

    /** Exchanges the browser's result for tokens and stores the session. */
    public suspend fun completeSignIn(callback: AuthorizationCallback): SignInResult

    /**
     * Device flow (RFC 8628, Android TV): requests the user code to show. Throws `AedstError` (also when the build is
     * not configured or the IdP lacks the device endpoint).
     */
    public suspend fun beginDeviceSignIn(): DeviceAuthorization

    /** Polls until approved/denied/expired (cancel the caller to abort) and stores the session like [completeSignIn]. */
    public suspend fun awaitDeviceSignIn(authorization: DeviceAuthorization): DeviceSignInResult

    /** Best-effort revoke at the IdP (RFC 7009), then always clears the local session. */
    public suspend fun logout()
}
