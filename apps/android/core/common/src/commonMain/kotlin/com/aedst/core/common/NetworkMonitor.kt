package com.aedst.core.common

import kotlinx.coroutines.flow.Flow

/**
 * Observable connectivity, so UI can show an offline banner and use cases can pick "send now" vs. "queue". Declared
 * here (common code) because feature domains depend on it; Android implements it in `core/network`
 * (`ConnectivityNetworkMonitor`).
 */
public interface NetworkMonitor {
    /** Emits the current state on collection, then every change. `true` = a validated internet connection exists. */
    public val isOnline: Flow<Boolean>
}
