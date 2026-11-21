package com.aedst.core.common

import kotlinx.coroutines.flow.Flow

/** Ids of the app's coarse features: the names `docs/contract/behavior/capabilities.json` and the server use. */
public object AedstFeature {
    public const val AUTH: String = "auth"
    public const val TASKS: String = "tasks"
    public const val MEDIA: String = "media"
    public const val SEARCH: String = "search"
    public const val NOTIFICATIONS: String = "notifications"
    public const val ADMIN: String = "admin"
}

/**
 * What capability negotiation (ADR-0009) lets the UI show: the features this build contains AND the server has not
 * switched off, plus whether a non-blocking "please update" prompt is due.
 */
public data class FeatureAvailability(val enabled: Set<String>, val updateRecommended: Boolean = false) {
    /** `null` (a route this app does not know) is never enabled. */
    public fun isEnabled(feature: String?): Boolean = feature != null && feature in enabled
}

/**
 * App-wide capabilities, next to [ClientUpgradeState]: `app/` and `app-tv/` filter navigation and deep links on
 * [availability] and call [refresh] on start-up and resume. Implemented in `core/capabilities`.
 */
public interface CapabilitiesState {
    /** What is shown when nothing was ever fetched: built-in features on, flagged ones off. */
    public val defaults: FeatureAvailability

    /** Re-emits whenever the cached server answer changes. Never fails. */
    public val availability: Flow<FeatureAvailability>

    /** Fetches `GetCapabilities` (unless fetched in the last few minutes and not [force]d); a failure keeps the cache. */
    public suspend fun refresh(force: Boolean = false)
}
