package com.aedst.android

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aedst.android.navigation.AppNavHost
import com.aedst.core.analytics.NavigationTelemetry
import com.aedst.core.navigation.AedstRoutes
import com.aedst.core.ui.components.AedstOfflineBanner
import com.aedst.core.ui.screens.UpgradeRequiredScreen
import com.aedst.core.ui.theme.AedstTheme
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    private val viewModel: MainViewModel by viewModels()

    @Inject
    lateinit var navigationTelemetry: NavigationTelemetry

    override fun onCreate(savedInstanceState: Bundle?) {
        // Must run before super.onCreate. Hold the splash until the persisted session is known, so a signed-in user
        // never sees a flash of the login screen.
        installSplashScreen().setKeepOnScreenCondition { viewModel.isSignedIn.value == null }
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        if (savedInstanceState == null) handleDeepLink(intent)

        setContent {
            val isSignedIn by viewModel.isSignedIn.collectAsStateWithLifecycle()
            val isOffline by viewModel.isOffline.collectAsStateWithLifecycle()
            val isAdmin by viewModel.isAdmin.collectAsStateWithLifecycle()
            val pendingRoute by viewModel.pendingRoute.collectAsStateWithLifecycle()
            val features by viewModel.features.collectAsStateWithLifecycle()
            val showUpdatePrompt by viewModel.showUpdatePrompt.collectAsStateWithLifecycle()
            val failedWrites by viewModel.failedWrites.collectAsStateWithLifecycle()

            // Start-up and every return to the foreground; the repository skips it when the last answer is recent.
            LifecycleEventEffect(Lifecycle.Event.ON_START) { viewModel.refreshCapabilities() }

            val upgradeRequired by viewModel.upgradeRequired.collectAsStateWithLifecycle()

            AedstTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    if (upgradeRequired) {
                        // ADR-0009: this build is refused by the server; nothing else is reachable until it is updated.
                        UpgradeRequiredScreen()
                    } else {
                        Column(modifier = Modifier.fillMaxSize()) {
                            AedstOfflineBanner(isOffline = isOffline)
                            OutboxFailedAlert(
                                failedCount = failedWrites,
                                onRetry = viewModel::retryFailedWrites,
                                onDiscard = viewModel::discardFailedWrites,
                            )
                            if (showUpdatePrompt) {
                                UpdateRecommendedBanner(onDismiss = viewModel::onUpdatePromptDismissed)
                            }
                            AppNavHost(
                                isSignedIn = isSignedIn,
                                isAdmin = isAdmin,
                                features = features,
                                pendingRoute = pendingRoute,
                                onPendingRouteHandled = viewModel::onDeepLinkHandled,
                                navigationTelemetry = navigationTelemetry,
                            )
                        }
                    }
                }
            }
        }
    }

    /** A notification tap while the activity exists (launchMode singleTop via the PendingIntent flags). */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleDeepLink(intent)
    }

    /**
     * Two sources, one validation: the `link` extra of a notification tap, or the https URL of an App Link
     * (`ACTION_VIEW`, `https://<host>/tasks/<id>`), whose path is the in-app link. Only routes
     * `AedstRoutes.routeForLink` accepts are honoured; anything else is ignored.
     */
    private fun handleDeepLink(intent: Intent?) {
        val appLink = intent?.takeIf { it.action == Intent.ACTION_VIEW }?.data
            ?.let { AedstRoutes.linkForAppLink(it.scheme, it.path) }
        viewModel.onDeepLink(intent?.getStringExtra(AedstRoutes.EXTRA_LINK) ?: appLink)
    }
}
