package com.aedst.core.security

import org.junit.jupiter.api.Assertions.assertDoesNotThrow
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test

class KeystoreProtectionTest {

    @Test
    fun `a keyset the Keystore does not protect is refused`() {
        assertThrows(IllegalStateException::class.java) { requireKeystoreProtected(isUsingKeystore = false) }
    }

    @Test
    fun `a Keystore-protected keyset is accepted`() {
        assertDoesNotThrow { requireKeystoreProtected(isUsingKeystore = true) }
    }
}
