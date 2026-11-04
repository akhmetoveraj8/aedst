package com.aedst.core.network

/** Who this build says it is in `X-Aedst-Client: <platform>/<semver>` (ADR-0009); `core/capabilities` compares with it. */
object ClientIdentity {
    const val PLATFORM = "android"

    /** The marketing version baked into this build (`-Paedst.versionName`). */
    val version: String get() = BuildConfig.CLIENT_VERSION
}
