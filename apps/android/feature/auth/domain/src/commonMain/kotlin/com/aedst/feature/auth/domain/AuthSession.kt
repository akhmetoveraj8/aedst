package com.aedst.feature.auth.domain.model

/** Domain entity — no ConnectRPC/Room/DataStore/AppAuth types leak in here, mirrors `modules/auth/domain`. */
data class AuthSession(
    /** The OIDC subject (`sub`) of the signed-in user, as the IdP issued it. */
    val userId: String,
    val accessToken: String,
    val refreshToken: String,
    /** Absolute expiry of [accessToken] (Unix epoch seconds), derived from the token response's `expires_in`. */
    val accessExpiresAtEpochSeconds: Long,
)
