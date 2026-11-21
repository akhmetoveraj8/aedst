package com.aedst.core.common

import kotlinx.coroutines.flow.StateFlow

/**
 * App-wide view of "who is signed in", published by `feature/auth` and
 * consumed by `app/` (routing between the auth graph and the rest of the app,
 * including when a refresh token is rejected behind the user's back) and by
 * cross-cutting modules (telemetry user id, push registration, role-gated
 * navigation). Declared here so nobody imports another module's domain layer.
 */
public interface SessionState {
    /** `null` while the persisted session is still being restored from disk, so callers can hold the splash screen. */
    public val isSignedIn: StateFlow<Boolean?>

    /** The signed-in user, or `null` when signed out or not yet restored. */
    public val currentUser: StateFlow<SessionUser?>
}

/**
 * Identity as far as the client UI is concerned. [roles] are read from the access token's claims **for UI gating
 * only** (e.g. hiding the admin area); the server enforces every role check itself (AEDST_ROLE_POLICY).
 */
public data class SessionUser(val id: String, val roles: Set<String> = emptySet()) {
    public val isAdmin: Boolean get() = ROLE_ADMIN in roles

    public companion object {
        public const val ROLE_ADMIN: String = "admin"
    }
}
