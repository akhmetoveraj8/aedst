package com.aedst.feature.auth.data.oidc

/**
 * Everything the OIDC client needs to know about this build's identity provider. Values come from `BuildConfig`
 * (Gradle properties, see `feature/auth/build.gradle.kts`); the type itself is plain so it is trivially testable.
 *
 * @param redirectScheme the app's application id: a reverse-DNS private-use URI scheme (RFC 8252 section 7.1). It
 *   must equal the `appAuthRedirectScheme` manifest placeholder of the hosting app module.
 */
data class OidcConfig(
    val issuer: String,
    val clientId: String,
    val projectId: String,
    val redirectScheme: String,
    /** Debug builds only: allow a plain-http issuer (the local ZITADEL dev stack). Never true in release. */
    val allowCleartextIssuer: Boolean = false,
) {
    /** A missing issuer or client id degrades to a "sign-in is not configured" screen instead of a crash. */
    val isConfigured: Boolean
        get() = issuer.isNotBlank() && clientId.isNotBlank() && redirectScheme.isNotBlank()

    /** `com.aedst.android:/oauth2redirect` — single slash, no authority, as RFC 8252 section 7.1 recommends. */
    val redirectUri: String
        get() = "$redirectScheme:$REDIRECT_PATH"

    /** Issuer without a trailing slash, the form discovery documents and ID tokens carry. */
    val normalizedIssuer: String
        get() = issuer.trim().trimEnd('/')

    /**
     * `openid profile email offline_access` plus, when a ZITADEL project id is configured, the audience scope (so the
     * access token's `aud` contains the project the server validates) and the project roles scope.
     */
    val scopes: List<String>
        get() = buildList {
            addAll(BASE_SCOPES)
            if (projectId.isNotBlank()) {
                add("urn:zitadel:iam:org:project:id:${projectId.trim()}:aud")
                add(ROLES_SCOPE)
            }
        }

    companion object {
        const val REDIRECT_PATH = "/oauth2redirect"
        const val ROLES_SCOPE = "urn:zitadel:iam:org:project:roles"
        val BASE_SCOPES = listOf("openid", "profile", "email", "offline_access")
    }
}
