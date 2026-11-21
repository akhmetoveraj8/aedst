package com.aedst.feature.auth.domain

/**
 * RFC 8628 device authorization response, minus transport details. [userCode] and the verification URLs are shown to
 * the user; [deviceCode] is the secret the device polls with and never leaves the data layer / is never displayed or
 * logged (hence the hand-written `toString`).
 */
public class DeviceAuthorization(
    public val userCode: String,
    public val verificationUri: String,
    /** `verification_uri_complete` (code pre-filled), when the IdP offers one. */
    public val verificationUriComplete: String?,
    public val expiresInSeconds: Long,
    /** Minimum seconds between polls (RFC 8628 section 3.2; 5 when the IdP omits it). */
    public val intervalSeconds: Long,
    public val deviceCode: String,
) {
    override fun toString(): String = "DeviceAuthorization(userCode=$userCode, verificationUri=$verificationUri)"
}

/** What the polling loop ended with; transport/config failures are thrown as `AedstError` instead. */
public sealed interface DeviceTokenResult {
    public data class Tokens(val tokens: OidcTokens) : DeviceTokenResult

    /** The user rejected the request on their phone (`access_denied`). */
    public data object Denied : DeviceTokenResult

    /** The code expired before approval (`expired_token`, or the local deadline passed). */
    public data object Expired : DeviceTokenResult
}

/** Outcome of [com.aedst.feature.auth.domain.AuthRepository.awaitDeviceSignIn]. */
public sealed interface DeviceSignInResult {
    public data class SignedIn(val session: AuthSession) : DeviceSignInResult

    public data object Denied : DeviceSignInResult

    public data object Expired : DeviceSignInResult
}
