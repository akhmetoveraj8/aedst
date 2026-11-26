package com.aedst.core.ui.components.support

import android.icu.text.CompactDecimalFormat
import android.icu.text.NumberFormat
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEvent
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.isShiftPressed
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.type
import androidx.compose.ui.platform.LocalConfiguration
import java.net.URI
import java.util.Locale

// Shared logic of the AI Elements kit parts (prompt input, context, inline citation, sources). Kept out of the
// kit root so the manifest gate does not see a component file without an entry.

/** Host name without `www.`, or [url] itself when it has no host (web `citationHostname`). */
internal fun citationHostname(url: String): String {
    val host = runCatching { URI(url).host }.getOrNull()
    return host?.removePrefix("www.") ?: url
}

/**
 * True for an absolute `http` / `https` URL. Source links come from model output, so the default opener only
 * follows web links and never `intent:`, `file:`, `content:`, `tel:` or other schemes that launch apps.
 */
internal fun isWebUrl(url: String): Boolean {
    val uri = runCatching { URI(url) }.getOrNull() ?: return false
    val scheme = uri.scheme?.lowercase(Locale.ROOT)
    return (scheme == "http" || scheme == "https") && !uri.host.isNullOrEmpty()
}

/** Share of the context window used, 0..1, clamped; 0 when [maxTokens] is not positive (web `ratio`). */
internal fun contextRatio(usedTokens: Long, maxTokens: Long): Float =
    if (maxTokens > 0) (usedTokens.toDouble() / maxTokens).coerceIn(0.0, 1.0).toFloat() else 0f

/** Locale-aware number formats of the context meter: compact token counts and a whole percentage. */
internal class AiNumberFormats(locale: Locale) {
    private val compact = CompactDecimalFormat.getInstance(locale, CompactDecimalFormat.CompactStyle.SHORT).apply {
        setSignificantDigitsUsed(false)
        setMaximumFractionDigits(1)
    }
    private val percent = NumberFormat.getPercentInstance(locale).apply { setMaximumFractionDigits(0) }

    /** "128K", "1.2M" (web `notation: "compact", maximumFractionDigits: 1`). */
    fun tokens(value: Long): String = compact.format(value)

    /** "42%" in the locale's own form, e.g. "42 %" or "٪٤٢". */
    fun percent(ratio: Float): String = percent.format(ratio.toDouble())
}

/** [AiNumberFormats] for the current configuration locale, rebuilt only when the locale changes. */
@Composable
internal fun rememberAiNumberFormats(): AiNumberFormats {
    val locale = LocalConfiguration.current.locales[0]
    return remember(locale) { AiNumberFormats(locale) }
}

/**
 * Hardware-keyboard Enter without Shift (web: Enter sends, Shift+Enter adds a line). Only the key-down is matched;
 * Shift+Enter is left to the text field, which inserts the newline.
 */
internal fun KeyEvent.isSubmitKey(): Boolean =
    type == KeyEventType.KeyDown && (key == Key.Enter || key == Key.NumPadEnter) && !isShiftPressed
