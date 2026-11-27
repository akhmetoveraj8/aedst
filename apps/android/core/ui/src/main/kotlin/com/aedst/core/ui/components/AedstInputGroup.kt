package com.aedst.core.ui.components

import android.content.res.Configuration
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.disabled
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.aedst.core.ui.theme.AedstHairline
import com.aedst.core.ui.theme.AedstShapesScale
import com.aedst.core.ui.theme.AedstSpacing
import com.aedst.core.ui.theme.AedstTheme

/** Where the addon of an [AedstInputGroup] sits, mirroring web's `input-group.tsx` addon `align` prop. */
enum class AedstInputGroupAlign {
    INLINE_START,
    INLINE_END,
    BLOCK_START,
    BLOCK_END,
}

/** Size of an [AedstInputGroupButton], mirroring web's `InputGroupButton` `size` prop (xs, sm, icon-xs, icon-sm). */
enum class AedstInputGroupButtonSize(internal val buttonSize: AedstButtonSize) {
    XS(AedstButtonSize.XS),
    SM(AedstButtonSize.SM),
    ICON_XS(AedstButtonSize.ICON_XS),
    ICON_SM(AedstButtonSize.ICON_SM),
}

/**
 * A text input and its addon (an icon, a unit, a button) inside one border, mirroring web's `input-group.tsx`.
 * [label] is the accessible name of the input (there is no floating label; pair it with `AedstField` for a visible
 * one). The addon goes before / after the text ([AedstInputGroupAlign.INLINE_START] / `INLINE_END`, RTL-aware) or on
 * its own row above / below it (`BLOCK_START` / `BLOCK_END`). With [maxLines] > 1 the input is a growing text area
 * (web `InputGroupTextarea`); [header] is an extra top row in the block layouts (attachment chips) and
 * [textFieldModifier] reaches the text field itself (key handling).
 */
@Composable
fun AedstInputGroup(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    textFieldModifier: Modifier = Modifier,
    placeholder: String? = null,
    enabled: Boolean = true,
    align: AedstInputGroupAlign = AedstInputGroupAlign.INLINE_START,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
    keyboardActions: KeyboardActions = KeyboardActions.Default,
    maxLines: Int = 1,
    header: (@Composable () -> Unit)? = null,
    addon: @Composable RowScope.() -> Unit,
) {
    val colorScheme = MaterialTheme.colorScheme
    val input: @Composable (Modifier) -> Unit = { inputModifier ->
        BasicTextField(
            value = value,
            onValueChange = onValueChange,
            modifier = inputModifier.then(textFieldModifier).semantics {
                contentDescription = label
                if (!enabled) disabled()
            },
            enabled = enabled,
            singleLine = maxLines == 1,
            maxLines = maxLines,
            keyboardActions = keyboardActions,
            textStyle = MaterialTheme.typography.bodyLarge.copy(color = LocalContentColor.current),
            keyboardOptions = keyboardOptions,
            cursorBrush = SolidColor(colorScheme.primary),
            decorationBox = { field ->
                Box(contentAlignment = Alignment.CenterStart) {
                    if (value.isEmpty() && placeholder != null) {
                        Text(
                            text = placeholder,
                            style = MaterialTheme.typography.bodyLarge,
                            color = colorScheme.onSurfaceVariant,
                        )
                    }
                    field()
                }
            },
        )
    }
    val addonRow: @Composable () -> Unit = {
        Row(
            horizontalArrangement = Arrangement.spacedBy(AedstSpacing.xs),
            verticalAlignment = Alignment.CenterVertically,
            content = addon,
        )
    }
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = AedstShapesScale.medium,
        color = colorScheme.surface,
        contentColor = if (enabled) colorScheme.onSurface else colorScheme.onSurfaceVariant,
        border = BorderStroke(AedstHairline, colorScheme.outline),
    ) {
        val padding = Modifier.heightIn(min = 48.dp).padding(horizontal = AedstSpacing.md, vertical = AedstSpacing.xs)
        when (align) {
            AedstInputGroupAlign.INLINE_START, AedstInputGroupAlign.INLINE_END -> Row(
                modifier = padding,
                horizontalArrangement = Arrangement.spacedBy(AedstSpacing.sm),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (align == AedstInputGroupAlign.INLINE_START) addonRow()
                input(Modifier.weight(1f))
                if (align == AedstInputGroupAlign.INLINE_END) addonRow()
            }

            AedstInputGroupAlign.BLOCK_START, AedstInputGroupAlign.BLOCK_END -> Column(
                modifier = padding,
                verticalArrangement = Arrangement.spacedBy(AedstSpacing.sm, Alignment.CenterVertically),
            ) {
                header?.invoke()
                if (align == AedstInputGroupAlign.BLOCK_START) addonRow()
                input(Modifier.fillMaxWidth())
                if (align == AedstInputGroupAlign.BLOCK_END) addonRow()
            }
        }
    }
}

/** A button inside an [AedstInputGroup] addon. For the `ICON_*` sizes [text] is the accessible name. */
@Composable
fun AedstInputGroupButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    size: AedstInputGroupButtonSize = AedstInputGroupButtonSize.XS,
    enabled: Boolean = true,
    icon: (@Composable RowScope.() -> Unit)? = null,
) {
    AedstButton(
        text = text,
        onClick = onClick,
        modifier = modifier,
        variant = AedstButtonVariant.GHOST,
        size = size.buttonSize,
        enabled = enabled,
        leadingIcon = icon,
    )
}

@Preview(name = "Light", showBackground = true)
@Preview(name = "Dark", uiMode = Configuration.UI_MODE_NIGHT_YES, showBackground = true)
@Composable
private fun AedstInputGroupPreview() {
    AedstTheme {
        Surface {
            Column(
                modifier = Modifier.padding(AedstSpacing.lg),
                verticalArrangement = Arrangement.spacedBy(AedstSpacing.sm),
            ) {
                AedstInputGroup(value = "", onValueChange = {}, label = "Search", placeholder = "Search") {
                    Icon(Icons.Default.Search, contentDescription = null)
                }
                AedstInputGroup(
                    value = "aedst.example",
                    onValueChange = {},
                    label = "Website",
                    align = AedstInputGroupAlign.INLINE_END,
                ) {
                    AedstInputGroupButton(text = "Copy", onClick = {})
                }
            }
        }
    }
}
