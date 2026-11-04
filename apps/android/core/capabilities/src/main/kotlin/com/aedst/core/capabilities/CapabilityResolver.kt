package com.aedst.core.capabilities

/** What `GetCapabilities` says, reduced to what the app acts on (no generated types: the resolver stays pure). */
data class ServerCapabilities(
    val features: Map<String, Feature>,
    val clients: Map<String, ClientWindow> = emptyMap(),
    val updateStatus: UpdateStatus = UpdateStatus.UNSPECIFIED,
) {
    /** [requiredClientVersion] (`Feature.required_client_version`) is the oldest release that may show it; null = none. */
    data class Feature(val enabled: Boolean, val requiredClientVersion: String? = null)

    /** The support window of one platform; an empty string means "not configured". */
    data class ClientWindow(val minimum: String = "", val recommended: String = "")

    enum class UpdateStatus { UNSPECIFIED, CURRENT, RECOMMENDED }
}

/**
 * The features this build contains and which of them need the server's explicit consent.
 *
 * @property version marketing version, e.g. `1.3.0`.
 * @property features feature ids compiled into the app.
 * @property flagged built features that stay hidden until the server enables them.
 */
data class ClientBuild(val platform: String, val version: String, val features: Set<String>, val flagged: Set<String>)

/** Orders marketing versions (`1.4`, `1.4.0`, `2`) numerically, so `1.10.0 > 1.9.0` and `1.3 == 1.3.0`. */
object VersionOrder {
    private const val MAX_COMPONENTS = 3

    /** Negative, zero or positive like [Comparable]; `null` when either side is not 1-3 numeric components. */
    fun compare(left: String, right: String): Int? {
        val a = parse(left) ?: return null
        val b = parse(right) ?: return null
        return a.zip(b).map { (x, y) -> x.compareTo(y) }.firstOrNull { it != 0 } ?: 0
    }

    private fun parse(raw: String): List<Int>? {
        val parts = raw.trim().split('.')
        if (parts.size !in 1..MAX_COMPONENTS) return null
        val numbers = parts.map { part -> if (part.all { c -> c in '0'..'9' }) part.toIntOrNull() else null }
        if (numbers.any { it == null }) return null
        return numbers.filterNotNull() + List(MAX_COMPONENTS - parts.size) { 0 }
    }
}

/** The five rules of `docs/contract/behavior/capabilities.json` as pure functions. */
object CapabilityResolver {
    /**
     * Shown iff built AND not switched off by the server (and old enough for `requiredClientVersion`).
     *
     * - [capabilities] `null`: nothing was ever fetched, so built-in features are on and flagged ones off.
     * - A fetched answer names features explicitly and `enabled` wins. A built feature it does not list falls back to
     *   the same defaults: the server lists dotted/operator names (`media.uploads`, `new_search`), not the app's
     *   coarse ids. Server names the build does not know are never looked at.
     */
    fun isEnabled(feature: String, build: ClientBuild, capabilities: ServerCapabilities?): Boolean {
        if (feature !in build.features) return false
        val default = feature !in build.flagged
        val entry = capabilities?.features?.get(feature) ?: return default
        if (!entry.enabled) return false
        val required = entry.requiredClientVersion ?: return true
        return (VersionOrder.compare(build.version, required) ?: 0) >= 0
    }

    fun enabledFeatures(build: ClientBuild, capabilities: ServerCapabilities?): Set<String> =
        build.features.filterTo(mutableSetOf()) { isEnabled(it, build, capabilities) }

    /** The server normally rejects such a build first (`CLIENT_UPGRADE_REQUIRED`); this covers a changed window. */
    fun isBelowMinimum(build: ClientBuild, capabilities: ServerCapabilities?): Boolean =
        isBelow(build.version, capabilities?.clients?.get(build.platform)?.minimum)

    /**
     * Whether the non-blocking update prompt is due: the platform's `recommended` window decides when it is set (so a
     * cached "RECOMMENDED" goes away once the user updates), else the server's own `update_status`.
     */
    fun isUpdateRecommended(build: ClientBuild, capabilities: ServerCapabilities?): Boolean {
        val recommended = capabilities?.clients?.get(build.platform)?.recommended
        return if (recommended.isNullOrBlank()) {
            capabilities?.updateStatus == ServerCapabilities.UpdateStatus.RECOMMENDED
        } else {
            isBelow(build.version, recommended)
        }
    }

    private fun isBelow(version: String, bound: String?): Boolean =
        !bound.isNullOrBlank() && (VersionOrder.compare(version, bound) ?: 0) < 0
}
