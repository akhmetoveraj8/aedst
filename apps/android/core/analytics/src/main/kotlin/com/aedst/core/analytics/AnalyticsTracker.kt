package com.aedst.core.analytics

import kotlinx.coroutines.flow.Flow

/**
 * Product-analytics facade every feature depends on instead of the PostHog SDK, so swapping providers (or running a
 * no-op in tests) never touches feature code — the same reason `internal/platform/observability` wraps slog/OTel on
 * the server. Events are dropped unless the user opted in ([AnalyticsConsentStore]) and a project key is configured.
 *
 * Never put PII (e-mail, names, free text, tokens) in [logEvent] params: send kinds, counts and ids only.
 * Identity (`identify`/`reset`) is handled centrally from `SessionState`, not by features.
 */
interface AnalyticsTracker {
    fun logEvent(name: String, params: Map<String, Any?> = emptyMap())

    /** A screen view; pass the route *template* (`tasks/{taskId}`), never a concrete id. */
    fun screen(name: String)
}

/**
 * Remote feature flags (PostHog), matching apps/web. Returns [default] when flags are disabled, not loaded yet, or
 * the user has not consented — so every flag must have a safe default.
 */
interface FeatureFlags {
    fun isEnabled(key: String, default: Boolean = false): Boolean

    /** Asks the provider to refetch flags (e.g. after sign-in). */
    fun reload()
}

/** Opt-in state for product analytics. Crash/error reporting is operational and not gated by it (as on web). */
enum class AnalyticsConsentState { UNSET, GRANTED, DENIED }

interface AnalyticsConsentStore {
    val consent: Flow<AnalyticsConsentState>

    suspend fun setConsent(granted: Boolean)
}
