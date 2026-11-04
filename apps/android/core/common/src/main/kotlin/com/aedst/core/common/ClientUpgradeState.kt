package com.aedst.core.common

import kotlinx.coroutines.flow.StateFlow

/**
 * App-wide "this build is too old" signal (ADR-0009 / ADR-0013), next to [SessionState]: `app/` routes on it and shows
 * a blocking upgrade screen. Published by `core/network` when any RPC is answered with Connect `failed_precondition`
 * and the `CLIENT_UPGRADE_REQUIRED` error reason. It latches: only installing a newer build clears it (process restart).
 */
interface ClientUpgradeState {
    val upgradeRequired: StateFlow<Boolean>
}
