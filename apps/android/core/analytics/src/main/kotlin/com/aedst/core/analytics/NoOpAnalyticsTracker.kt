package com.aedst.core.analytics

/** Test double / disabled implementation: no event ever leaves the device. */
class NoOpAnalyticsTracker : AnalyticsTracker {
    override fun logEvent(name: String, params: Map<String, Any?>) = Unit
    override fun screen(name: String) = Unit
}

/** Test double: every flag returns its default. */
class NoOpFeatureFlags : FeatureFlags {
    override fun isEnabled(key: String, default: Boolean): Boolean = default
    override fun reload() = Unit
}
