package com.aedst.core.security

import androidx.datastore.core.CorruptionException
import androidx.datastore.core.Serializer
import com.google.crypto.tink.Aead
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import java.io.InputStream
import java.io.OutputStream
import java.security.GeneralSecurityException

/**
 * DataStore [Serializer] that JSON-encodes [SecretEntries] and seals the bytes
 * with a Tink [Aead] (AES-256-GCM). An empty file decodes to the default
 * value. Anything that fails authentication/decoding (tampering, lost
 * Keystore key after a restore) surfaces as [CorruptionException] so the
 * DataStore corruption handler can reset it instead of crashing.
 */
internal class AeadSerializer(private val aead: Lazy<Aead>) : Serializer<SecretEntries> {

    override val defaultValue: SecretEntries = SecretEntries()

    override suspend fun readFrom(input: InputStream): SecretEntries {
        val sealed = input.readBytes()
        if (sealed.isEmpty()) return defaultValue
        return try {
            val plain = aead.value.decrypt(sealed, ASSOCIATED_DATA)
            Json.decodeFromString(SecretEntries.serializer(), plain.decodeToString())
        } catch (e: GeneralSecurityException) {
            throw CorruptionException("Cannot decrypt secure store", e)
        } catch (e: SerializationException) {
            throw CorruptionException("Cannot decode secure store", e)
        }
    }

    override suspend fun writeTo(t: SecretEntries, output: OutputStream) {
        val plain = Json.encodeToString(SecretEntries.serializer(), t).encodeToByteArray()
        output.write(aead.value.encrypt(plain, ASSOCIATED_DATA))
    }

    private companion object {
        val ASSOCIATED_DATA = "aedst.secure_store.v1".encodeToByteArray()
    }
}
