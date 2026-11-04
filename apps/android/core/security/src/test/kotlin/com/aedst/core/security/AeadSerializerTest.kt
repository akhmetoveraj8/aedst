package com.aedst.core.security

import androidx.datastore.core.CorruptionException
import com.google.crypto.tink.Aead
import com.google.crypto.tink.KeysetHandle
import com.google.crypto.tink.RegistryConfiguration
import com.google.crypto.tink.aead.AeadConfig
import com.google.crypto.tink.aead.PredefinedAeadParameters
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream

class AeadSerializerTest {

    private fun newAead(): Aead {
        AeadConfig.register()
        return KeysetHandle.generateNew(PredefinedAeadParameters.AES256_GCM)
            .getPrimitive(RegistryConfiguration.get(), Aead::class.java)
    }

    private suspend fun seal(serializer: AeadSerializer, data: SecretEntries): ByteArray {
        val out = ByteArrayOutputStream()
        serializer.writeTo(data, out)
        return out.toByteArray()
    }

    @Test
    fun `round trips entries and never stores plaintext`() = runTest {
        val serializer = AeadSerializer(lazyOf(newAead()))
        val data = SecretEntries(mapOf("auth.access_token" to "super-secret-token"))

        val sealed = seal(serializer, data)

        assertFalse(sealed.decodeToString().contains("super-secret-token"))
        assertEquals(data, serializer.readFrom(ByteArrayInputStream(sealed)))
    }

    @Test
    fun `empty file reads as the default value`() = runTest {
        val serializer = AeadSerializer(lazyOf(newAead()))

        assertEquals(SecretEntries(), serializer.readFrom(ByteArrayInputStream(ByteArray(0))))
    }

    @Test
    fun `data sealed with another key is reported as corruption`() = runTest {
        val sealed = seal(AeadSerializer(lazyOf(newAead())), SecretEntries(mapOf("k" to "v")))

        assertThrows(CorruptionException::class.java) {
            kotlinx.coroutines.runBlocking { AeadSerializer(lazyOf(newAead())).readFrom(ByteArrayInputStream(sealed)) }
        }
    }

    @Test
    fun `a flipped ciphertext byte is reported as corruption`() = runTest {
        val aead = newAead()
        val sealed = seal(AeadSerializer(lazyOf(aead)), SecretEntries(mapOf("k" to "v")))
        sealed[sealed.size - 1] = (sealed[sealed.size - 1].toInt() xor 1).toByte()

        assertThrows(CorruptionException::class.java) {
            kotlinx.coroutines.runBlocking { AeadSerializer(lazyOf(aead)).readFrom(ByteArrayInputStream(sealed)) }
        }
    }

    @Test
    fun `data sealed for another purpose is rejected even with the right key`() = runTest {
        val aead = newAead()
        val foreign = aead.encrypt("""{"entries":{"k":"v"}}""".encodeToByteArray(), "someone.else".encodeToByteArray())

        assertThrows(CorruptionException::class.java) {
            kotlinx.coroutines.runBlocking { AeadSerializer(lazyOf(aead)).readFrom(ByteArrayInputStream(foreign)) }
        }
    }

    @Test
    fun `authentic bytes that are not a valid store are reported as corruption`() = runTest {
        val aead = newAead()
        val notJson = aead.encrypt("not json".encodeToByteArray(), "aedst.secure_store.v1".encodeToByteArray())

        assertThrows(CorruptionException::class.java) {
            kotlinx.coroutines.runBlocking { AeadSerializer(lazyOf(aead)).readFrom(ByteArrayInputStream(notJson)) }
        }
    }

    @Test
    fun `the key is only created when the store is first used`() = runTest {
        var created = 0
        val serializer = AeadSerializer(
            lazy {
                created++
                newAead()
            },
        )

        serializer.readFrom(ByteArrayInputStream(ByteArray(0)))
        assertEquals(0, created)

        seal(serializer, SecretEntries(mapOf("k" to "v")))
        assertEquals(1, created)
    }
}
