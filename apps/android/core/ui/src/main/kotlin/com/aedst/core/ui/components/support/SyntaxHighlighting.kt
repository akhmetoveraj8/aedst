package com.aedst.core.ui.components.support

import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import com.aedst.core.common.DefaultDispatcherProvider
import com.aedst.core.common.DispatcherProvider
import com.aedst.core.ui.theme.AedstExtendedColors
import com.aedst.core.ui.theme.AedstThemeExtras
import dev.snipme.highlights.Highlights
import dev.snipme.highlights.model.PhraseLocation
import dev.snipme.highlights.model.SyntaxLanguage
import kotlinx.coroutines.withContext

/** Production dispatchers for the kit's off-main-thread work (syntax analysis); tests pass their own explicitly. */
private val KitDispatchers: DispatcherProvider = DefaultDispatcherProvider()

/** Token kinds the kit colours, one per `syntax*` design token that the highlighter can produce. */
internal enum class SyntaxKind { PUNCTUATION, KEYWORD, NUMBER, TYPE, STRING, COMMENT }

/** One coloured range of the code: [start] inclusive, [end] exclusive. */
@Immutable
internal data class SyntaxSpan(val start: Int, val end: Int, val kind: SyntaxKind)

/** The highlighter's language for a web-style language name (`kotlin`, `kt`, `ts`, `bash`...), or null for plain text. */
internal fun syntaxLanguageOf(language: String?): SyntaxLanguage? {
    val name = language?.trim()?.lowercase()?.takeIf { it.isNotEmpty() } ?: return null
    return LANGUAGE_ALIASES[name] ?: SyntaxLanguage.getByName(name)?.takeIf { it != SyntaxLanguage.DEFAULT }
}

private val LANGUAGE_ALIASES = mapOf(
    "kt" to SyntaxLanguage.KOTLIN,
    "kts" to SyntaxLanguage.KOTLIN,
    "ts" to SyntaxLanguage.TYPESCRIPT,
    "tsx" to SyntaxLanguage.TYPESCRIPT,
    "js" to SyntaxLanguage.JAVASCRIPT,
    "jsx" to SyntaxLanguage.JAVASCRIPT,
    "mjs" to SyntaxLanguage.JAVASCRIPT,
    "py" to SyntaxLanguage.PYTHON,
    "sh" to SyntaxLanguage.SHELL,
    "bash" to SyntaxLanguage.SHELL,
    "zsh" to SyntaxLanguage.SHELL,
    "rs" to SyntaxLanguage.RUST,
    "c++" to SyntaxLanguage.CPP,
    "cs" to SyntaxLanguage.CSHARP,
    "c#" to SyntaxLanguage.CSHARP,
    "golang" to SyntaxLanguage.GO,
    "rb" to SyntaxLanguage.RUBY,
    "pl" to SyntaxLanguage.PERL,
    "coffee" to SyntaxLanguage.COFFEESCRIPT,
)

/**
 * Token ranges of [code] from the Highlights library, ordered so that later kinds win where ranges overlap (a keyword
 * inside a string or comment is not coloured as a keyword). Pure and CPU-bound: call it off the main thread.
 */
internal fun analyzeSyntax(code: String, language: SyntaxLanguage): List<SyntaxSpan> {
    val structure = Highlights.Builder(code = code, language = language).build().getCodeStructure()
    val groups = listOf(
        SyntaxKind.PUNCTUATION to structure.punctuations,
        SyntaxKind.KEYWORD to structure.keywords,
        SyntaxKind.NUMBER to structure.literals,
        SyntaxKind.TYPE to structure.annotations,
        SyntaxKind.STRING to structure.strings,
        SyntaxKind.COMMENT to structure.comments + structure.multilineComments,
    )
    return groups.flatMap { (kind, locations) -> locations.mapNotNull { it.toSpan(kind, code.length) } }
}

private fun PhraseLocation.toSpan(kind: SyntaxKind, length: Int): SyntaxSpan? {
    val from = start.coerceIn(0, length)
    val to = end.coerceIn(0, length)
    return if (from < to) SyntaxSpan(from, to, kind) else null
}

/** [code] with the [spans] coloured by the `syntax*` tokens of [colors]. */
internal fun highlightedText(code: String, spans: List<SyntaxSpan>, colors: AedstExtendedColors): AnnotatedString =
    buildAnnotatedString {
        append(code)
        spans.forEach { span ->
            if (span.end <= code.length) addStyle(SpanStyle(color = colors.colorOf(span.kind)), span.start, span.end)
        }
    }

private fun AedstExtendedColors.colorOf(kind: SyntaxKind): Color = when (kind) {
    SyntaxKind.PUNCTUATION -> syntaxPunctuation
    SyntaxKind.KEYWORD -> syntaxKeyword
    SyntaxKind.NUMBER -> syntaxNumber
    SyntaxKind.TYPE -> syntaxType
    SyntaxKind.STRING -> syntaxString
    SyntaxKind.COMMENT -> syntaxComment
}

/**
 * [code] highlighted for [language]. Analysis runs on [DispatcherProvider.default] of [dispatchers] and is remembered
 * per code and language; until it finishes (and for an unknown language, or if the analysis fails) the text is plain.
 * While code streams in, the previous ranges stay applied (clamped to the new text) so the colours do not flicker.
 */
@Composable
internal fun rememberHighlightedCode(
    code: String,
    language: String?,
    dispatchers: DispatcherProvider = KitDispatchers,
): AnnotatedString {
    val colors = AedstThemeExtras.extendedColors
    val syntax = remember(language) { syntaxLanguageOf(language) }
    val spans by produceState(emptyList<SyntaxSpan>(), code, syntax, dispatchers) {
        value = if (syntax == null) emptyList() else withContext(dispatchers.default) { analyzeOrPlain(code, syntax) }
    }
    return remember(code, spans, colors) { highlightedText(code, spans, colors) }
}

/** The library throws on inputs it cannot parse; plain text is the documented fallback. */
@Suppress("TooGenericExceptionCaught") // third-party analyser: any failure degrades to plain text
private fun analyzeOrPlain(code: String, syntax: SyntaxLanguage): List<SyntaxSpan> = try {
    analyzeSyntax(code, syntax)
} catch (ignored: RuntimeException) {
    // Deliberately dropped: the documented fallback for an input the analyser rejects is plain text.
    emptyList()
}
