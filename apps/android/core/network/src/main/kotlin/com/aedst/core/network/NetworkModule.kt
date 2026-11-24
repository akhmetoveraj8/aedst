package com.aedst.core.network

import com.connectrpc.ProtocolClientConfig
import com.connectrpc.ProtocolClientInterface
import com.connectrpc.extensions.GoogleJavaLiteProtobufStrategy
import com.connectrpc.impl.ProtocolClient
import com.connectrpc.okhttp.ConnectOkHttpClient
import com.connectrpc.protocols.NetworkProtocol
import dev.zacsweers.metro.AppScope
import dev.zacsweers.metro.BindingContainer
import dev.zacsweers.metro.ContributesTo
import dev.zacsweers.metro.Provides
import dev.zacsweers.metro.SingleIn
import okhttp3.CertificatePinner
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import java.util.concurrent.TimeUnit

/**
 * Base network wiring shared by every feature's generated ConnectRPC service
 * client (mirrors `internal/platform` on the server, and Apple's
 * `ConnectClientFactory`). One [ProtocolClientInterface] per app process.
 */
@BindingContainer
@ContributesTo(AppScope::class)
object NetworkModule {

    private const val CONNECT_TIMEOUT_SECONDS = 10L
    private const val CALL_TIMEOUT_SECONDS = 30L

    /** Uploads of large videos over slow links: bound inactivity, not total duration. */
    private const val EXTERNAL_IO_TIMEOUT_SECONDS = 60L

    /** API client: first-party headers, bearer refresh, TLS pinning and (last) the tracing SDK's interceptor. */
    @Provides
    @SingleIn(AppScope::class)
    fun provideOkHttpClient(
        headersInterceptor: RequestHeadersInterceptor,
        authenticator: TokenRefreshAuthenticator,
        // Optional binding: `core/analytics` supplies it, a build without telemetry simply has none.
        httpTelemetry: HttpTelemetry? = null,
    ): OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(CONNECT_TIMEOUT_SECONDS, TimeUnit.SECONDS)
        // callTimeout bounds the whole call (DNS + connect + body), so a stalled radio can't hold a coroutine forever.
        .callTimeout(CALL_TIMEOUT_SECONDS, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .authenticator(authenticator)
        .addInterceptor(headersInterceptor)
        .addInterceptor(loggingInterceptor())
        .apply { buildCertificatePinner()?.let { pinner -> certificatePinner(pinner) } }
        // Sentry asks to be added last so it records the request exactly as sent.
        .apply { httpTelemetry?.let { addInterceptor(it.interceptor) } }
        .build()

    /**
     * Shares the API client's connection pool and dispatcher ([OkHttpClient.newBuilder]) but drops every interceptor
     * and the authenticator: presigned URLs must never receive the bearer token or first-party headers.
     */
    @Provides
    @SingleIn(AppScope::class)
    @ExternalHttpClient
    fun provideExternalOkHttpClient(apiClient: OkHttpClient): OkHttpClient = apiClient.newBuilder()
        .apply {
            interceptors().clear()
            networkInterceptors().clear()
        }
        .authenticator(okhttp3.Authenticator.NONE)
        .certificatePinner(CertificatePinner.DEFAULT)
        .callTimeout(0, TimeUnit.MILLISECONDS)
        .readTimeout(EXTERNAL_IO_TIMEOUT_SECONDS, TimeUnit.SECONDS)
        .writeTimeout(EXTERNAL_IO_TIMEOUT_SECONDS, TimeUnit.SECONDS)
        .addInterceptor(loggingInterceptor())
        .build()

    private fun loggingInterceptor() = HttpLoggingInterceptor().apply {
        // BASIC logs request/response lines (URLs) — never in release builds.
        level = if (BuildConfig.DEBUG) HttpLoggingInterceptor.Level.BASIC else HttpLoggingInterceptor.Level.NONE
        redactHeader("Authorization")
    }

    /**
     * Pins the API host to the SPKI hashes in [BuildConfig.CERT_PINS] (comma-separated `sha256/<base64>`; supply at
     * least two — the live key and a backup — via `-Paedst.certPins=...`). Empty ⇒ no pinning (debug/dev hosts);
     * release builds refuse to assemble without pins, see `core/network/build.gradle.kts`.
     */
    private fun buildCertificatePinner(): CertificatePinner? {
        val pins = BuildConfig.CERT_PINS.split(',').map(String::trim).filter(String::isNotEmpty)
        if (pins.isEmpty()) return null
        return CertificatePinner.Builder().apply { pins.forEach { add(ApiEndpoint.host, it) } }.build()
    }

    @Provides
    @SingleIn(AppScope::class)
    fun provideProtocolClient(
        okHttpClient: OkHttpClient,
        authInterceptor: AuthInterceptor,
        upgradeInterceptor: ClientUpgradeInterceptor,
    ): ProtocolClientInterface = ProtocolClient(
        httpClient = ConnectOkHttpClient(okHttpClient),
        ProtocolClientConfig(
            host = BuildConfig.BASE_URL,
            serializationStrategy = GoogleJavaLiteProtobufStrategy(),
            networkProtocol = NetworkProtocol.CONNECT,
            interceptors = listOf({ _ -> authInterceptor }, { _ -> upgradeInterceptor }),
        ),
    )
}
