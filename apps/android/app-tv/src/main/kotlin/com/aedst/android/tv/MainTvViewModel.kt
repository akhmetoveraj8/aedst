package com.aedst.android.tv

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.aedst.core.common.CapabilitiesState
import com.aedst.core.common.ClientUpgradeState
import dev.zacsweers.metro.AppScope
import dev.zacsweers.metro.ContributesIntoMap
import dev.zacsweers.metro.Inject
import dev.zacsweers.metrox.viewmodel.ViewModelKey
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

/**
 * TV shell state: the forced-upgrade latch (ADR-0009) and the capability refresh that can raise it. The TV app has no
 * tabs or deep links yet, so it consumes only the version window of `GetCapabilities`, not the per-feature switches.
 */
@ViewModelKey
@ContributesIntoMap(AppScope::class)
@Inject
class MainTvViewModel(clientUpgradeState: ClientUpgradeState, private val capabilitiesState: CapabilitiesState) :
    ViewModel() {

    /** `true` once the server rejected this build (CLIENT_UPGRADE_REQUIRED): the shell shows only the upgrade screen. */
    val upgradeRequired: StateFlow<Boolean> = clientUpgradeState.upgradeRequired

    /** Called whenever the app comes to the foreground; the repository skips it when the last answer is recent. */
    fun refreshCapabilities() {
        viewModelScope.launch { capabilitiesState.refresh() }
    }
}
