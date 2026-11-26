package com.aedst.core.ui.components

import android.content.res.Configuration
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.aedst.core.ui.R
import com.aedst.core.ui.components.support.rememberHighlightedCode
import com.aedst.core.ui.theme.AedstShapesScale
import com.aedst.core.ui.theme.AedstSpacing
import com.aedst.core.ui.theme.AedstTheme
import com.aedst.core.ui.theme.AedstTypeScale

/**
 * Read-only source code, mirroring web's `code-block.tsx`: an optional header with the [filename] and a copy
 * button, then the code in the mono type token with optional line numbers. Long lines scroll horizontally instead of
 * wrapping; code is always laid out left to right, also in RTL locales; the text is selectable. Copying is hoisted
 * ([onCopy], shown only when set) so the caller owns the clipboard and its confirmation message. [language] is shown in
 * the header and selects the syntax highlighting (Highlights library, coloured with the `syntax*` tokens, analysed off
 * the main thread); an unknown or missing language renders plain text.
 */
@Composable
fun AedstCodeBlock(
    code: String,
    modifier: Modifier = Modifier,
    filename: String? = null,
    language: String? = null,
    showLineNumbers: Boolean = false,
    onCopy: (() -> Unit)? = null,
) {
    val style = TextStyle(
        fontFamily = FontFamily.Monospace,
        fontSize = AedstTypeScale.monoFontSize,
        lineHeight = AedstTypeScale.monoLineHeight.value.sp,
        fontWeight = FontWeight(AedstTypeScale.MONO_FONT_WEIGHT),
    )
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = AedstShapesScale.large,
        color = MaterialTheme.colorScheme.surfaceVariant,
        contentColor = MaterialTheme.colorScheme.onSurface,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Column {
            if (filename != null || language != null || onCopy != null) {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(start = AedstSpacing.md),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = filename.orEmpty(),
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.weight(1f).padding(vertical = AedstSpacing.sm),
                    )
                    if (language != null) {
                        Text(
                            text = language,
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(horizontal = AedstSpacing.sm),
                        )
                    }
                    if (onCopy != null) {
                        AedstIconButton(
                            onClick = onCopy,
                            contentDescription = stringResource(R.string.aedst_a11y_copy_code),
                        ) {
                            Icon(Icons.Default.ContentCopy, contentDescription = null)
                        }
                    }
                }
                AedstDivider()
            }
            val highlighted = rememberHighlightedCode(code, language)
            CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Ltr) {
                Row(
                    modifier = Modifier.horizontalScroll(rememberScrollState()).padding(AedstSpacing.md),
                    horizontalArrangement = Arrangement.spacedBy(AedstSpacing.md),
                ) {
                    if (showLineNumbers) {
                        Text(
                            text = List(code.lines().size) { it + 1 }.joinToString("\n"),
                            style = style,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    SelectionContainer { Text(text = highlighted, style = style, softWrap = false) }
                }
            }
        }
    }
}

@Preview(name = "Light", showBackground = true)
@Preview(name = "Dark", uiMode = Configuration.UI_MODE_NIGHT_YES, showBackground = true)
@Composable
private fun AedstCodeBlockPreview() {
    AedstTheme {
        Surface {
            AedstCodeBlock(
                code = "fun main() {\n    println(\"Hello\")\n}",
                filename = "Main.kt",
                language = "kotlin",
                showLineNumbers = true,
                onCopy = {},
                modifier = Modifier.padding(AedstSpacing.lg),
            )
        }
    }
}
