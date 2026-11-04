package com.aedst.feature.auth.navigation

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier

/**
 * How `feature/auth` renders the single primary action of a TV-capable screen (device sign-in's "get a new code", the
 * account screen's "sign out"). By default the screens draw their touch `AedstButton`; `app-tv` passes a D-pad button
 * from `:core:ui-tv` through `AuthNavGraph`, because this module must not depend on TV widgets (they stay out of the
 * phone APK).
 */
typealias AuthActionButton = @Composable (
    text: String,
    onClick: () -> Unit,
    modifier: Modifier,
    enabled: Boolean,
    loading: Boolean,
) -> Unit
