package com.aedst.core.analytics

import com.aedst.core.common.AppInitializer
import com.aedst.core.common.ApplicationScope
import com.aedst.core.common.SessionState
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Starts Sentry and PostHog first thing in `Application.onCreate` (priority [AppInitializer.PRIORITY_TELEMETRY]),
 * then keeps their identity and consent in sync:
 *  - signed-in user id → Sentry user + PostHog `identify`; sign-out → cleared / `reset`;
 *  - consent GRANTED → PostHog `optIn`, anything else → `optOut`.
 */
class TelemetryInitializer @Inject constructor(
    private val sentry: SentryTelemetry,
    private val postHog: PostHogAnalytics,
    private val consentStore: AnalyticsConsentStore,
    private val sessionState: SessionState,
    @ApplicationScope private val scope: CoroutineScope,
) : AppInitializer {

    override val priority: Int = AppInitializer.PRIORITY_TELEMETRY

    override fun initialize() {
        sentry.setUp()
        postHog.setUp()

        scope.launch {
            sessionState.currentUser.map { it?.id }.distinctUntilChanged().collect { userId ->
                sentry.setUser(userId)
                postHog.identify(userId)
                if (userId != null) postHog.reload()
            }
        }
        scope.launch {
            consentStore.consent.collect { consent -> postHog.setConsent(consent == AnalyticsConsentState.GRANTED) }
        }
    }
}
