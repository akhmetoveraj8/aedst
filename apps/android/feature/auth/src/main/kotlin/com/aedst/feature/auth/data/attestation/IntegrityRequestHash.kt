package com.aedst.feature.auth.data.attestation

import java.security.MessageDigest
import java.util.Base64

/**
 * The request-binding convention shared with the server (integrity.proto):
 * `base64url_nopad(SHA-256("aedst.integrity.v1\n" + action + "\n" + payload))`, always 43 characters.
 */
object IntegrityRequestHash {
    private const val DOMAIN = "aedst.integrity.v1"
    private val base64Url = Base64.getUrlEncoder().withoutPadding()

    fun compute(action: String, payload: ByteArray): String {
        val digest = MessageDigest.getInstance("SHA-256")
        digest.update("$DOMAIN\n$action\n".toByteArray(Charsets.UTF_8))
        digest.update(payload)
        return base64Url.encodeToString(digest.digest())
    }
}
