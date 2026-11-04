package com.aedst.core.capabilities

import com.aedst.core.common.AedstError
import com.aedst.core.common.CapabilitiesState
import com.aedst.core.common.FeatureAvailability
import com.aedst.core.network.ClientUpgradeGate
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.time.Clock
import java.time.Duration
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.coroutines.cancellation.CancellationException

/**
 * Capability negotiation (ADR-0009, `docs/contract/behavior/capabilities.json`). The cache is the single source of
 * truth: [refresh] writes the server's answer into it and [availability] is derived from it, so "a failed fetch falls
 * back to the last known capabilities, then to the build's defaults" needs no special case.
 *
 * A fresh answer that puts this build below its platform minimum latches the forced-upgrade screen
 * ([ClientUpgradeGate]), the same path an RPC rejected with `CLIENT_UPGRADE_REQUIRED` takes.
 */
@Singleton
class CapabilitiesService @Inject constructor(
    private val remote: CapabilitiesRemote,
    private val cache: CapabilitiesCache,
    private val build: ClientBuild,
    private val upgradeGate: ClientUpgradeGate,
    private val clock: Clock,
) : CapabilitiesState {

    private val mutex = Mutex()
    private var lastFetchMillis: Long? = null

    override val defaults: FeatureAvailability = availabilityOf(null)

    override val availability: Flow<FeatureAvailability> = cache.lastKnown
        .map { response -> availabilityOf(response?.toServerCapabilities()) }
        .distinctUntilChanged()

    override suspend fun refresh(force: Boolean) {
        mutex.withLock {
            val now = clock.millis()
            val last = lastFetchMillis
            if (!force && last != null && now - last < MIN_INTERVAL.toMillis()) return
            try {
                val response = remote.fetch()
                cache.save(response)
                lastFetchMillis = now
                if (CapabilityResolver.isBelowMinimum(build, response.toServerCapabilities())) upgradeGate.report()
            } catch (cancellation: CancellationException) {
                throw cancellation
            } catch (@Suppress("SwallowedException") e: AedstError) {
                // Offline, rate-limited, 5xx or an old build the gate already reported ([rpc] maps every failure to an
                // AedstError): keep what the cache holds.
            }
        }
    }

    private fun availabilityOf(capabilities: ServerCapabilities?) = FeatureAvailability(
        enabled = CapabilityResolver.enabledFeatures(build, capabilities),
        updateRecommended = CapabilityResolver.isUpdateRecommended(build, capabilities),
    )

    private companion object {
        /** The answer does not depend on the user, so resume-triggered refreshes within this window are skipped. */
        val MIN_INTERVAL: Duration = Duration.ofMinutes(5)
    }
}
