package com.aedst.core.security

/**
 * Facade over the app's encrypted key/value store (a DataStore whose file is
 * sealed with a Tink AES-256-GCM AEAD, the keyset wrapped by an Android
 * Keystore master key — see [TinkEncryptedPreferences]). Feature modules
 * never touch SharedPreferences/DataStore directly for secrets — they depend
 * on this interface, the same way they depend on `core/network`'s
 * [com.aedst.core.network.AuthTokenProvider] rather than OkHttp.
 *
 * All operations are suspending (disk + Keystore I/O) and each mutating call
 * is one atomic DataStore transaction.
 */
interface EncryptedPreferences {
    suspend fun getString(key: String): String?

    /** Snapshot of every stored entry. */
    suspend fun getAll(): Map<String, String>

    suspend fun putString(key: String, value: String)

    /** Writes all [entries] in a single atomic transaction. */
    suspend fun putAll(entries: Map<String, String>)

    suspend fun remove(vararg keys: String)

    suspend fun clear()
}
