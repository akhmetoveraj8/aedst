package com.aedst.feature.auth.domain.model

/**
 * What a token endpoint call (authorization-code exchange or refresh) yields, independent of AppAuth.
 *
 * [refreshToken] is null when the IdP did not return one (a refresh that does not rotate keeps the old token; a
 * sign-in without one is rejected by the repository). [subject] comes from the ID token (falling back to the
 * access token) and is null if neither carried one.
 */
data class OidcTokens(
    val accessToken: String,
    val refreshToken: String?,
    val accessExpiresAtEpochSeconds: Long,
    val subject: String?,
)

/**
 * The browser round trip, as an opaque hand-off: the data layer builds the platform `Intent` that opens the Custom
 * Tab, the view model passes it on untouched, and the Compose layer launches it. Keeping it `Any` keeps
 * `domain/` and the view model free of Android types and JVM-testable.
 */
class AuthorizationLaunch(val platformIntent: Any)

/** What came back from the browser round trip: the result `Intent` (or null if the system delivered nothing). */
class AuthorizationCallback(val platformIntent: Any?)

/** Outcome of preparing a sign-in. */
sealed interface BeginSignInResult {
    /** Launch [launch] to show the IdP's hosted login. */
    data class Ready(val launch: AuthorizationLaunch) : BeginSignInResult

    /** Issuer or client id is not configured for this build. */
    data object NotConfigured : BeginSignInResult

    /** No installed browser can handle the sign-in (AppAuth found no matching browser). */
    data object NoBrowser : BeginSignInResult
}

/** Outcome of finishing a sign-in after the browser returned. */
sealed interface SignInResult {
    data class SignedIn(val session: AuthSession) : SignInResult

    /** The user backed out of the browser (or the system delivered no result). Not an error. */
    data object Cancelled : SignInResult
}
