package com.aedst.android

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.aedst.core.common.CapabilitiesState
import com.aedst.core.common.ClientUpgradeState
import com.aedst.core.common.FeatureAvailability
import com.aedst.core.common.SessionState
import com.aedst.core.navigation.AedstRoutes
import com.aedst.core.network.NetworkMonitor
import com.aedst.core.outbox.OutboxRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * App-shell state: which graph to show (from the session), whether to show the offline banner and the admin entry,
 * and a pending deep link from a tapped notification.
 */
@HiltViewModel
class MainViewModel @Inject constructor(
    sessionState: SessionState,
    networkMonitor: NetworkMonitor,
    clientUpgradeState: ClientUpgradeState,
    private val capabilitiesState: CapabilitiesState,
    private val outbox: OutboxRepository,
) : ViewModel() {

    /** `true` once the server rejected this build (CLIENT_UPGRADE_REQUIRED): the shell shows only the upgrade screen. */
    val upgradeRequired: StateFlow<Boolean> = clientUpgradeState.upgradeRequired

    /** Features the server has not switched off (ADR-0009 capability negotiation); defaults until the cache is read. */
    val features: StateFlow<FeatureAvailability> = capabilitiesState.availability
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MS), capabilitiesState.defaults)

    private val updatePromptDismissed = MutableStateFlow(false)

    /** The non-blocking "new version available" prompt: due by the server's window, and not dismissed this process. */
    val showUpdatePrompt: StateFlow<Boolean> = combine(features, updatePromptDismissed) { available, dismissed ->
        available.updateRecommended && !dismissed
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MS), false)

    fun onUpdatePromptDismissed() {
        updatePromptDismissed.value = true
    }

    /** Called whenever the app comes to the foreground; the repository skips it when the last answer is recent. */
    fun refreshCapabilities() {
        viewModelScope.launch { capabilitiesState.refresh() }
    }

    /** `null` while the persisted session is being restored — the splash screen stays up until this is non-null. */
    val isSignedIn: StateFlow<Boolean?> = sessionState.isSignedIn

    val isAdmin: StateFlow<Boolean> = sessionState.currentUser
        .map { it?.isAdmin == true }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MS), false)

    val isOffline: StateFlow<Boolean> = networkMonitor.isOnline
        .map { online -> !online }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MS), false)

    /** Queued writes the sync gave up on; the shell offers to retry or discard them. */
    val failedWrites: StateFlow<Int> = outbox.failedCount
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MS), 0)

    fun retryFailedWrites() {
        viewModelScope.launch { outbox.retryFailed() }
    }

    fun discardFailedWrites() {
        viewModelScope.launch { outbox.discardFailed() }
    }

    private val mutablePendingRoute = MutableStateFlow<String?>(null)

    /** Route to open once signed in (from a notification's `link`); consumed by the nav host. */
    val pendingRoute: StateFlow<String?> = mutablePendingRoute.asStateFlow()

    /** Accepts only links [AedstRoutes.routeForLink] validates; anything else is ignored. */
    fun onDeepLink(link: String?) {
        AedstRoutes.routeForLink(link)?.let { mutablePendingRoute.value = it }
    }

    fun onDeepLinkHandled() {
        mutablePendingRoute.value = null
    }

    private companion object {
        const val STOP_TIMEOUT_MS = 5_000L
    }
}
