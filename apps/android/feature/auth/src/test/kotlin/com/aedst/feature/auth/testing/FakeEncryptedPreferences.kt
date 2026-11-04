package com.aedst.feature.auth.testing

import com.aedst.core.security.EncryptedPreferences

/** In-memory [EncryptedPreferences] — no real Keystore access under JVM unit tests. */
class FakeEncryptedPreferences : EncryptedPreferences {
    private val values = mutableMapOf<String, String>()
    override suspend fun getString(key: String): String? = values[key]
    override suspend fun getAll(): Map<String, String> = values.toMap()
    override suspend fun putString(key: String, value: String) {
        values[key] = value
    }
    override suspend fun putAll(entries: Map<String, String>) {
        values.putAll(entries)
    }
    override suspend fun remove(vararg keys: String) {
        keys.forEach(values::remove)
    }
    override suspend fun clear() {
        values.clear()
    }
}
