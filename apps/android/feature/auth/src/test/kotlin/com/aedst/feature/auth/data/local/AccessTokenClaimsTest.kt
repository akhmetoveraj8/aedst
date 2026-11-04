package com.aedst.feature.auth.data.local

import com.aedst.feature.auth.testing.fakeJwt
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class AccessTokenClaimsTest {

    @Test
    fun `reads ZITADEL roles from the object keyed by role name`() {
        val token = fakeJwt(
            """{"sub":"1","urn:zitadel:iam:org:project:roles":{"admin":{"1":"acme.example"},"user":{"1":"x"}}}""",
        )

        assertEquals(setOf("admin", "user"), AccessTokenClaims.roles(token))
    }

    @Test
    fun `still reads a roles array and Keycloak realm roles`() {
        assertEquals(setOf("admin"), AccessTokenClaims.roles(fakeJwt("""{"roles":["admin"]}""")))
        assertEquals(setOf("user"), AccessTokenClaims.roles(fakeJwt("""{"realm_access":{"roles":["user"]}}""")))
    }

    @Test
    fun `no role claim or a non-JWT yields no roles`() {
        assertTrue(AccessTokenClaims.roles(fakeJwt("""{"sub":"1"}""")).isEmpty())
        assertTrue(AccessTokenClaims.roles("opaque").isEmpty())
    }

    @Test
    fun `reads the subject`() {
        assertEquals("u-9", AccessTokenClaims.subject(fakeJwt("""{"sub":"u-9"}""")))
        assertNull(AccessTokenClaims.subject(fakeJwt("""{"name":"x"}""")))
        assertNull(AccessTokenClaims.subject("opaque"))
    }

    @Test
    fun `recognises the JWT shape`() {
        assertTrue(AccessTokenClaims.isJwt(fakeJwt()))
        assertFalse(AccessTokenClaims.isJwt("a.b"))
        assertFalse(AccessTokenClaims.isJwt("opaque-token"))
    }
}
