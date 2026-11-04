package com.aedst.android.tv

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.tv.material3.Surface
import com.aedst.android.tv.navigation.AppTvNavHost
import com.aedst.core.ui.theme.AedstTheme
import com.aedst.core.ui.tv.TvUpgradeRequiredScreen
import dagger.hilt.android.AndroidEntryPoint

/**
 * TV counterpart to `:app`'s `MainActivity`. Same minimal-entry-point shape
 * (theme -> full-screen surface -> nav host), wiring the shared
 * `:feature:auth` nav graph via [AppTvNavHost] instead of duplicating any of
 * its business logic. Uses `androidx.tv.material3.Surface` rather than
 * Material3's `Surface` so the root container gets TV-appropriate focus/
 * color-group handling out of the box. When the server refuses this build
 * (ADR-0009) only the D-pad friendly upgrade screen is shown.
 */
@AndroidEntryPoint
class MainTvActivity : ComponentActivity() {
    private val viewModel: MainTvViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            val upgradeRequired by viewModel.upgradeRequired.collectAsStateWithLifecycle()
            // Start-up and every return to the foreground; the repository skips it when the last answer is recent.
            LifecycleEventEffect(Lifecycle.Event.ON_START) { viewModel.refreshCapabilities() }

            AedstTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    if (upgradeRequired) TvUpgradeRequiredScreen() else AppTvNavHost()
                }
            }
        }
    }
}
