package com.aedst.core.network

import okhttp3.Interceptor
import javax.inject.Qualifier

/**
 * Seam for the crash/tracing SDK (implemented by `core/analytics` with Sentry) so `core/network` never imports it.
 * Optional in the graph: without a binding the API client simply has no tracing interceptor.
 */
interface HttpTelemetry {
    /** Added **last** to the API [okhttp3.OkHttpClient] (it must observe the final request): spans + breadcrumbs. */
    val interceptor: Interceptor

    /**
     * `true` while the SDK itself propagates W3C `traceparent` (so the request shares a trace with the API's
     * OpenTelemetry spans). [RequestHeadersInterceptor] then does not add its own header, which would otherwise be
     * duplicated.
     */
    fun propagatesTraceparent(): Boolean
}

/**
 * The [okhttp3.OkHttpClient] for **third-party** hosts such as presigned object-storage URLs: no bearer token, no
 * token-refresh authenticator, no first-party headers or trace propagation, long write timeouts for large bodies.
 * Never use it for the API.
 */
@Qualifier
@Retention(AnnotationRetention.RUNTIME)
annotation class ExternalHttpClient
