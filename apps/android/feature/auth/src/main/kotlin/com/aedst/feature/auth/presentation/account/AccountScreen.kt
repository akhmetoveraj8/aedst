package com.aedst.feature.auth.presentation.account

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aedst.core.ui.adaptive.AedstAdaptiveContent
import com.aedst.core.ui.adaptive.AedstContentWidth
import com.aedst.core.ui.adaptive.AedstWindowSizePreviews
import com.aedst.core.ui.components.AedstButton
import com.aedst.core.ui.components.AedstButtonVariant
import com.aedst.core.ui.components.AedstSwitch
import com.aedst.core.ui.theme.AedstSpacing
import com.aedst.core.ui.theme.AedstTheme
import com.aedst.feature.auth.R
import com.aedst.feature.auth.navigation.AuthActionButton

@Composable
internal fun AccountRoute(actionButton: AuthActionButton?, viewModel: AccountViewModel = hiltViewModel()) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    AccountScreen(state = state, onIntent = viewModel::onIntent, actionButton = actionButton)
}

@Composable
internal fun AccountScreen(
    state: AccountState,
    onIntent: (AccountIntent) -> Unit,
    actionButton: AuthActionButton? = null,
) {
    AedstAdaptiveContent(maxWidth = AedstContentWidth.form) {
        AccountContent(state, onIntent, actionButton)
    }
}

@Composable
private fun AccountContent(state: AccountState, onIntent: (AccountIntent) -> Unit, actionButton: AuthActionButton?) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .safeDrawingPadding()
            .padding(AedstSpacing.xxl),
        verticalArrangement = Arrangement.spacedBy(AedstSpacing.lg),
    ) {
        if (state.userId != null) {
            Text(
                text = stringResource(R.string.auth_signed_in_as, state.userId),
                style = MaterialTheme.typography.bodyLarge,
            )
        }
        AedstSwitch(
            checked = state.isAnalyticsEnabled,
            onCheckedChange = { onIntent(AccountIntent.SetAnalyticsEnabled(it)) },
            label = stringResource(R.string.auth_analytics_consent),
            modifier = Modifier.fillMaxWidth(),
        )
        val signOutText = stringResource(R.string.auth_sign_out)
        val signOut = { onIntent(AccountIntent.SignOut) }
        if (actionButton != null) {
            actionButton(signOutText, signOut, Modifier.fillMaxWidth(), !state.isSigningOut, state.isSigningOut)
        } else {
            AedstButton(
                text = signOutText,
                onClick = signOut,
                variant = AedstButtonVariant.OUTLINE,
                loading = state.isSigningOut,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

@AedstWindowSizePreviews
@Composable
private fun AccountScreenPreview() {
    AedstTheme { AccountScreen(state = AccountState(userId = "user-1234"), onIntent = {}) }
}
