package com.aedst.core.analytics

import android.content.Context
import com.posthog.PostHog
import com.posthog.android.PostHogAndroid
import com.posthog.android.PostHogAndroidConfig
import dagger.hilt.android.qualifiers.ApplicationContext
import java.util.concurrent.atomic.AtomicBoolean
import javax.inject.Inject
import javax.inject.Singleton

/**
 * PostHog-backed [AnalyticsTracker] + [FeatureFlags]. Disabled entirely (no SDK init, no traffic) when
 * `BuildConfig.POSTHOG_KEY` is empty; otherwise set up **opted out** and only opted in once the user grants consent
 * (see [TelemetryInitializer]).
 */
@Singleton
class PostHogAnalytics @Inject constructor(@ApplicationContext private val context: Context) :
    AnalyticsTracker,
    FeatureFlags {

    private val isSetUp = AtomicBoolean(false)

    val isConfigured: Boolean get() = BuildConfig.POSTHOG_KEY.isNotBlank()

    fun setUp() {
        if (!isConfigured || !isSetUp.compareAndSet(false, true)) return
        val config = PostHogAndroidConfig(projectToken = BuildConfig.POSTHOG_KEY, host = BuildConfig.POSTHOG_HOST)
            .apply {
                // Consent first: nothing is captured until optIn().
                optOut = true
                // Compose has one Activity; screens are reported from navigation (NavigationTelemetry) instead.
                captureScreenViews = false
                captureDeepLinks = false
                capturePushNotificationSubscriptions = false
                capturePushNotificationOpened = false
                sessionReplay = false
                preloadFeatureFlags = true
            }
        PostHogAndroid.setup(context, config)
    }

    fun setConsent(granted: Boolean) {
        if (!isSetUp.get()) return
        if (granted) PostHog.optIn() else PostHog.optOut()
    }

    fun identify(userId: String?) {
        if (!isSetUp.get()) return
        if (userId == null) PostHog.reset() else PostHog.identify(distinctId = userId)
    }

    override fun logEvent(name: String, params: Map<String, Any?>) {
        if (!isSetUp.get()) return
        val properties = params.mapNotNull { (key, value) -> value?.let { key to it } }.toMap()
        PostHog.capture(event = name, properties = properties)
    }

    override fun screen(name: String) {
        if (!isSetUp.get()) return
        PostHog.screen(screenTitle = name)
    }

    override fun isEnabled(key: String, default: Boolean): Boolean =
        if (isSetUp.get() && !PostHog.isOptOut()) PostHog.isFeatureEnabled(key, defaultValue = default) else default

    override fun reload() {
        if (isSetUp.get()) PostHog.reloadFeatureFlags()
    }
}
