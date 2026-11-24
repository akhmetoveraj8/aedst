package com.aedst.core.analytics

import android.content.Context
import com.aedst.core.common.ApplicationContext
import com.aedst.core.common.ErrorReporter
import com.aedst.core.network.ApiEndpoint
import com.aedst.core.network.HttpTelemetry
import dev.zacsweers.metro.AppScope
import dev.zacsweers.metro.ContributesBinding
import dev.zacsweers.metro.Inject
import dev.zacsweers.metro.SingleIn
import io.sentry.Sentry
import io.sentry.android.core.SentryAndroid
import io.sentry.okhttp.SentryOkHttpInterceptor
import io.sentry.protocol.User
import okhttp3.Interceptor

/**
 * Sentry: crash + error reporting (one tool for the job, as on apps/web). Disabled (never initialised, no traffic)
 * when `BuildConfig.SENTRY_DSN` is empty.
 *
 *  - **Uncaught exceptions / ANRs / native crashes**: Sentry's default Android integrations install the global
 *    uncaught-exception handler; coroutine failures in the application scope arrive via [ErrorReporter].
 *  - **Release**: Sentry's Android default, `<applicationId>@<versionName>+<versionCode>`; R8 mappings are matched by
 *    the UUID the Sentry Gradle plugin embeds (see `app/build.gradle.kts`).
 *  - **PII**: only the user id is attached ([setUser]); no e-mail, IP, screenshots or view hierarchy.
 *  - **Tracing**: OkHttp spans + breadcrumbs via [SentryOkHttpInterceptor]; W3C `traceparent` is propagated to the
 *    API host only, so the server's OpenTelemetry trace continues the client span.
 */
@SingleIn(AppScope::class)
@Inject
class SentryTelemetry(@ApplicationContext private val context: Context) {

    val isConfigured: Boolean get() = BuildConfig.SENTRY_DSN.isNotBlank()

    fun setUp() {
        if (!isConfigured) return
        SentryAndroid.init(context) { options ->
            options.dsn = BuildConfig.SENTRY_DSN
            options.environment = BuildConfig.ENVIRONMENT
            options.tracesSampleRate = TRACES_SAMPLE_RATE
            options.isPropagateTraceparent = true
            options.setTracePropagationTargets(listOf(ApiEndpoint.host))
            options.isAttachScreenshot = false
            options.isAttachViewHierarchy = false
            options.isEnableUserInteractionBreadcrumbs = true
        }
    }

    /** User id only — never e-mail or name. `null` clears it on sign-out. */
    fun setUser(userId: String?) {
        if (!Sentry.isEnabled()) return
        Sentry.setUser(userId?.let { id -> User().apply { this.id = id } })
    }

    private companion object {
        /** 20 % of transactions; errors are always sent. Tune per product. */
        const val TRACES_SAMPLE_RATE = 0.2
    }
}

/** [ErrorReporter] for non-fatal errors (application-scope coroutine failures, caught-but-unexpected errors). */
@ContributesBinding(AppScope::class)
@Inject
class SentryErrorReporter : ErrorReporter {
    override fun recordNonFatal(throwable: Throwable) {
        if (Sentry.isEnabled()) Sentry.captureException(throwable)
    }
}

/** Plugs Sentry's OkHttp integration into `core/network`'s API client without `core/network` depending on Sentry. */
@ContributesBinding(AppScope::class)
@Inject
class SentryHttpTelemetry : HttpTelemetry {
    override val interceptor: Interceptor = SentryOkHttpInterceptor()

    override fun propagatesTraceparent(): Boolean = Sentry.isEnabled()
}
