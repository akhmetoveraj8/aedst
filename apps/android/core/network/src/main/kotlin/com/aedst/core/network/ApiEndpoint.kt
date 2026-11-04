package com.aedst.core.network

/** The first-party API this build talks to (per build type, see `core/network/build.gradle.kts`). */
object ApiEndpoint {
    val baseUrl: String get() = BuildConfig.BASE_URL

    /** Host of [baseUrl]: the TLS-pinned host and the only trace-propagation target for the tracing SDK. */
    val host: String by lazy { java.net.URI(BuildConfig.BASE_URL).host }
}
