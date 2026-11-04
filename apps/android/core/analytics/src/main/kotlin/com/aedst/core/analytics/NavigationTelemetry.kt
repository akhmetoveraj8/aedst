package com.aedst.core.analytics

import io.sentry.Breadcrumb
import io.sentry.Sentry
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Navigation -> telemetry: a PostHog `screen` event and a Sentry navigation breadcrumb whenever the top destination of
 * the back stack changes. Navigation 3 has no listener API (the back stack is app-owned state), so the app shell
 * observes its top key and calls [onScreenChanged]; this class stays free of any navigation dependency.
 *
 * Names are route *templates* (`tasks/{taskId}`), never concrete ids, so nothing sensitive leaks into analytics.
 *
 * A singleton on purpose: the activity is re-created on rotation and on process-preserving config changes, and an
 * instance per activity would forget the last screen and report the same screen view again after every recreate.
 */
@Singleton
class NavigationTelemetry @Inject constructor(private val analytics: AnalyticsTracker) {

    private var lastScreen: String? = null

    /** Reports a move to [screenName]; repeated calls for the same screen (recomposition, tab reselect) are ignored. */
    fun onScreenChanged(screenName: String) {
        val previous = lastScreen
        if (previous == screenName) return
        lastScreen = screenName
        analytics.screen(screenName)
        if (Sentry.isEnabled()) {
            Sentry.addBreadcrumb(Breadcrumb.navigation(previous ?: APP_START, screenName))
        }
    }

    private companion object {
        const val APP_START = "app-start"
    }
}
