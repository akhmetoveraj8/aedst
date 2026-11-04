package com.aedst.feature.auth.data.oidc

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class OidcConfigTest {

    private val configured = OidcConfig(
        issuer = "https://auth.example.com/",
        clientId = "client-1",
        projectId = "123456",
        redirectScheme = "com.aedst.android",
    )

    @Test
    fun `a build with issuer and client id is configured`() {
        assertTrue(configured.isConfigured)
    }

    @Test
    fun `a missing client id or issuer degrades to not configured`() {
        assertFalse(configured.copy(clientId = "").isConfigured)
        assertFalse(configured.copy(issuer = " ").isConfigured)
        assertFalse(configured.copy(redirectScheme = "").isConfigured)
    }

    @Test
    fun `the redirect URI is the reverse-DNS private-use scheme with a single slash`() {
        assertEquals("com.aedst.android:/oauth2redirect", configured.redirectUri)
        val tv = configured.copy(redirectScheme = "com.aedst.android.tv")
        assertEquals("com.aedst.android.tv:/oauth2redirect", tv.redirectUri)
    }

    @Test
    fun `the issuer is normalised without a trailing slash`() {
        assertEquals("https://auth.example.com", configured.normalizedIssuer)
    }

    @Test
    fun `scopes carry the ZITADEL project audience and roles when a project id is set`() {
        assertEquals(
            listOf(
                "openid",
                "profile",
                "email",
                "offline_access",
                "urn:zitadel:iam:org:project:id:123456:aud",
                "urn:zitadel:iam:org:project:roles",
            ),
            configured.scopes,
        )
    }

    @Test
    fun `without a project id only the standard OIDC scopes are requested`() {
        assertEquals(OidcConfig.BASE_SCOPES, configured.copy(projectId = "").scopes)
    }
}
