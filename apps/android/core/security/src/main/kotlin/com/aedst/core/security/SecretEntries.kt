package com.aedst.core.security

import kotlinx.serialization.Serializable

/** Plaintext payload sealed by [AeadSerializer]; never written to disk unencrypted. */
@Serializable
internal data class SecretEntries(val entries: Map<String, String> = emptyMap())
