package com.aedst.feature.auth.data.oidc

import com.aedst.core.common.AedstError
import com.aedst.feature.auth.testing.fakeJwt
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset

class OidcTokenMappingTest {

    private val clock = Clock.fixed(Instant.ofEpochSecond(1_000), ZoneOffset.UTC)
    private val access = fakeJwt("""{"sub":"access-sub"}""")

    @Test
    fun `maps expiry from epoch millis to seconds and takes sub from the ID token`() {
        val tokens = oidcTokensFrom(
            accessToken = access,
            idToken = fakeJwt("""{"sub":"id-sub"}"""),
            refreshToken = "refresh",
            accessExpirationMillis = 1_900_999L,
            clock = clock,
        )

        assertEquals(access, tokens.accessToken)
        assertEquals("refresh", tokens.refreshToken)
        assertEquals(1_900L, tokens.accessExpiresAtEpochSeconds)
        assertEquals("id-sub", tokens.subject)
    }

    @Test
    fun `falls back to the access token sub when there is no ID token`() {
        val tokens = oidcTokensFrom(access, null, null, accessExpirationMillis = 1L, clock = clock)

        assertEquals("access-sub", tokens.subject)
        assertNull(tokens.refreshToken)
    }

    @Test
    fun `a blank refresh token counts as none`() {
        val tokens = oidcTokensFrom(access, null, " ", 1L, clock)

        assertNull(tokens.refreshToken)
    }

    @Test
    fun `a missing expiry falls back to a short lifetime from now`() {
        val tokens = oidcTokensFrom(access, null, "r", accessExpirationMillis = null, clock = clock)

        assertEquals(1_300L, tokens.accessExpiresAtEpochSeconds)
    }

    @Test
    fun `an opaque access token is rejected with an actionable message`() {
        val thrown = runCatching { oidcTokensFrom("opaque-token-value", null, "r", 1L, clock) }.exceptionOrNull()

        assertTrue(thrown is AedstError.Unknown)
        assertTrue(thrown?.message.orEmpty().contains("JWT"))
    }

    @Test
    fun `a missing access token is rejected`() {
        val thrown = runCatching { oidcTokensFrom(null, null, "r", 1L, clock) }.exceptionOrNull()

        assertTrue(thrown is AedstError.Unknown)
    }
}
