package com.aedst.core.network

import okhttp3.Interceptor
import okhttp3.Response
import java.security.SecureRandom
import java.util.Optional
import javax.inject.Inject

/**
 * Adds the headers every first-party request carries:
 *  - `X-Aedst-Client: android/<semver>` — client identification per ADR-0009 (metrics, version gate; not authN);
 *  - `traceparent` (W3C Trace Context) — a fresh trace id per request so a slow/failed call can be found in the
 *    server's OpenTelemetry traces from a crash report or support ticket.
 */
class RequestHeadersInterceptor @Inject constructor(private val httpTelemetry: Optional<HttpTelemetry>) :
    Interceptor {
    private val random = SecureRandom()

    override fun intercept(chain: Interceptor.Chain): Response {
        val builder = chain.request().newBuilder()
            .header(CLIENT_HEADER, "android/${BuildConfig.CLIENT_VERSION}")
        // When Sentry is active it propagates `traceparent` itself (tied to its own span, so the crash report and the
        // server's OTel trace share one trace id); adding ours too would produce two conflicting headers.
        val tracingSdkOwnsTraceparent = httpTelemetry.map { it.propagatesTraceparent() }.orElse(false)
        if (!tracingSdkOwnsTraceparent) builder.header(TRACEPARENT_HEADER, newTraceparent())
        return chain.proceed(builder.build())
    }

    /** `00-<32 hex trace id>-<16 hex span id>-01` (version 00, sampled). */
    private fun newTraceparent(): String = "00-${randomHex(TRACE_ID_BYTES)}-${randomHex(SPAN_ID_BYTES)}-01"

    private fun randomHex(byteCount: Int): String {
        val bytes = ByteArray(byteCount).also(random::nextBytes)
        // An all-zero id is invalid per the spec; flip one bit in the (astronomically unlikely) case.
        if (bytes.all { it == 0.toByte() }) bytes[0] = 1
        return bytes.toHexString()
    }

    companion object {
        const val CLIENT_HEADER = "X-Aedst-Client"
        const val TRACEPARENT_HEADER = "traceparent"
        private const val TRACE_ID_BYTES = 16
        private const val SPAN_ID_BYTES = 8
    }
}
