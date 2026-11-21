package com.aedst.feature.auth.domain.model

/**
 * RFC 8628 device authorization response, minus transport details. [userCode] and the verification URLs are shown to
 * the user; [deviceCode] is the secret the device polls with and never leaves the data layer / is never displayed or
 * logged (hence the hand-written `toString`).
 */
class DeviceAuthorization(
    val userCode: String,
    val verificationUri: String,
    /** `verification_uri_complete` (code pre-filled), when the IdP offers one. */
    val verificationUriComplete: String?,
    val expiresInSeconds: Long,
    /** Minimum seconds between polls (RFC 8628 section 3.2; 5 when the IdP omits it). */
    val intervalSeconds: Long,
    val deviceCode: String,
) {
    override fun toString(): String = "DeviceAuthorization(userCode=$userCode, verificationUri=$verificationUri)"
}

/** What the polling loop ended with; transport/config failures are thrown as `AedstError` instead. */
sealed interface DeviceTokenResult {
    data class Tokens(val tokens: OidcTokens) : DeviceTokenResult

    /** The user rejected the request on their phone (`access_denied`). */
    data object Denied : DeviceTokenResult

    /** The code expired before approval (`expired_token`, or the local deadline passed). */
    data object Expired : DeviceTokenResult
}

/** Outcome of [com.aedst.feature.auth.domain.repository.AuthRepository.awaitDeviceSignIn]. */
sealed interface DeviceSignInResult {
    data class SignedIn(val session: AuthSession) : DeviceSignInResult

    data object Denied : DeviceSignInResult

    data object Expired : DeviceSignInResult
}
