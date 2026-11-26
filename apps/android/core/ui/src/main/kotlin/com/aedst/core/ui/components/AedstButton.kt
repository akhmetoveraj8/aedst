package com.aedst.core.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.disabled
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.aedst.core.ui.R
import com.aedst.core.ui.theme.AedstShapesScale
import androidx.compose.material3.Button as Material3Button

/** Visual treatment of [AedstButton], mirroring web's `button.tsx` `variant` prop. */
enum class AedstButtonVariant {
    DEFAULT,
    OUTLINE,
    SECONDARY,
    GHOST,
    DESTRUCTIVE,
    LINK,
}

/**
 * Sizing of [AedstButton], mirroring web's `button.tsx` `size` prop (ui-kit.yaml: default, xs, sm, lg, icon, icon-xs,
 * icon-sm, icon-lg). The `ICON*` sizes are square and render only the `leadingIcon` slot; `text` becomes the
 * accessible name. Visual heights are denser than 48dp; Material keeps the touch target at 48dp.
 */
enum class AedstButtonSize(
    internal val height: Dp,
    internal val horizontalPadding: Dp,
    internal val iconOnly: Boolean,
) {
    DEFAULT(40.dp, 16.dp, false),
    XS(28.dp, 8.dp, false),
    SM(32.dp, 12.dp, false),
    LG(48.dp, 24.dp, false),
    ICON(40.dp, 0.dp, true),
    ICON_XS(28.dp, 0.dp, true),
    ICON_SM(32.dp, 0.dp, true),
    ICON_LG(48.dp, 0.dp, true),
}

/**
 * Primary action control. Rewritten to match the unified `core.ui` component standard: a
 * variant/size enum surface, a loading state that swaps content for a spinner without changing
 * bounds, and full dark-mode support via [MaterialTheme].
 */
@Composable
fun AedstButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    variant: AedstButtonVariant = AedstButtonVariant.DEFAULT,
    size: AedstButtonSize = AedstButtonSize.DEFAULT,
    enabled: Boolean = true,
    loading: Boolean = false,
    leadingIcon: (@Composable RowScope.() -> Unit)? = null,
    trailingIcon: (@Composable RowScope.() -> Unit)? = null,
) {
    val isEnabled = enabled && !loading
    val contentPadding = PaddingValues(horizontal = size.horizontalPadding)
    val heightModifier = if (size.iconOnly) Modifier.size(size.height) else Modifier.height(size.height)
    val shape = AedstShapesScale.medium
    // While loading the visible content is a spinner; keep the button named and announce its state.
    val loadingDescription = stringResource(R.string.aedst_a11y_loading)
    val buttonModifier = modifier.then(heightModifier).semantics {
        if (!isEnabled) disabled()
        if (loading || size.iconOnly) contentDescription = text
        if (loading) stateDescription = loadingDescription
    }

    val label: @Composable () -> Unit = {
        ButtonContent(
            text = text.takeUnless { size.iconOnly },
            loading = loading,
            leadingIcon = leadingIcon,
            trailingIcon = trailingIcon.takeUnless { size.iconOnly },
        )
    }

    when (variant) {
        AedstButtonVariant.DEFAULT -> Material3Button(
            onClick = onClick,
            modifier = buttonModifier,
            enabled = isEnabled,
            shape = shape,
            contentPadding = contentPadding,
            content = { label() },
        )

        AedstButtonVariant.SECONDARY -> Material3Button(
            onClick = onClick,
            modifier = buttonModifier,
            enabled = isEnabled,
            shape = shape,
            contentPadding = contentPadding,
            colors = ButtonDefaults.buttonColors(
                containerColor = MaterialTheme.colorScheme.secondary,
                contentColor = MaterialTheme.colorScheme.onSecondary,
            ),
            content = { label() },
        )

        AedstButtonVariant.DESTRUCTIVE -> Material3Button(
            onClick = onClick,
            modifier = buttonModifier,
            enabled = isEnabled,
            shape = shape,
            contentPadding = contentPadding,
            colors = ButtonDefaults.buttonColors(
                containerColor = MaterialTheme.colorScheme.error,
                contentColor = MaterialTheme.colorScheme.onError,
            ),
            content = { label() },
        )

        AedstButtonVariant.OUTLINE -> OutlinedButton(
            onClick = onClick,
            modifier = buttonModifier,
            enabled = isEnabled,
            shape = shape,
            contentPadding = contentPadding,
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
            content = { label() },
        )

        AedstButtonVariant.GHOST -> TextButton(
            onClick = onClick,
            modifier = buttonModifier,
            enabled = isEnabled,
            shape = shape,
            contentPadding = contentPadding,
            content = { label() },
        )

        AedstButtonVariant.LINK -> TextButton(
            onClick = onClick,
            modifier = modifier.semantics { if (!isEnabled) disabled() },
            enabled = isEnabled,
            contentPadding = PaddingValues(horizontal = 4.dp, vertical = 4.dp),
            content = {
                Text(text, textDecoration = TextDecoration.Underline)
            },
        )
    }
}

@Composable
private fun ButtonContent(
    text: String?,
    loading: Boolean,
    leadingIcon: (@Composable RowScope.() -> Unit)?,
    trailingIcon: (@Composable RowScope.() -> Unit)? = null,
) {
    if (loading) {
        CircularProgressIndicator(
            modifier = Modifier.size(16.dp),
            strokeWidth = 2.dp,
            color = LocalContentColor.current,
        )
        return
    }
    androidx.compose.foundation.layout.Row(
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = androidx.compose.ui.Alignment.CenterVertically,
    ) {
        leadingIcon?.invoke(this)
        if (text != null) Text(text)
        trailingIcon?.invoke(this)
    }
}
