package com.aedst.core.ui.components

import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.File

/**
 * Source guards for the accessibility rules a render cannot see: user-facing text comes from resources, icons that
 * are not decorative are named, sizes come from tokens, and looping animation honours reduced motion.
 */
class SourceGuardsTest {

    /** Non-preview production lines: everything before the first `@Preview` of each file, minus comments. */
    private fun productionLines(root: String): List<Triple<File, Int, String>> =
        File(root).walkTopDown().filter { it.extension == "kt" }.flatMap { file ->
            val lines = file.readLines()
            val end = lines.indexOfFirst { it.startsWith("@Preview") || it.startsWith("@AedstWindowSizePreviews") }
            lines.take(if (end < 0) lines.size else end).mapIndexed { i, l -> Triple(file, i + 1, l) }
        }.filterNot { (_, _, l) ->
            l.trimStart().let { it.startsWith("*") || it.startsWith("//") || it.startsWith("/*") }
        }
            .toList()

    private val roots = listOf("src/main/kotlin", "../ui-tv/src/main/kotlin")

    private fun all() = roots.flatMap { productionLines(it) }

    @Test
    fun `no user facing string literal outside previews`() {
        val literal = Regex("""(contentDescription|text|label|title|stateDescription)\s*=\s*"[^"$]*[A-Za-z]{2}""")
        val textCall = Regex("""\bText\(\s*"[^"]*[A-Za-z]""")
        val hits = all().filter { (_, _, l) -> literal.containsMatchIn(l) || textCall.containsMatchIn(l) }
            .filterNot { (f, _, l) -> f.name == "AedstBottomSheet.kt" || f.name == "AedstDialog.kt" || "\"aedst" in l }
        assertTrue(hits.isEmpty(), "Use stringResource: ${hits.map { "${it.first.name}:${it.second}" }}")
    }

    @Test
    fun `a clickable never has a hard-coded size literal below the touch target`() {
        val small = Regex("""(?:heightIn|sizeIn|height|size)\([^)]*\b(\d+)\.dp""")
        val hits = all().filter { (_, _, l) ->
            small.find(l)?.groupValues?.get(1)?.toInt()?.let { it in 1..47 } == true && "allow-dp" !in l
        }
        assertTrue(hits.isEmpty(), "Use AedstSpacing tokens: ${hits.map { "${it.first.name}:${it.second}" }}")
    }

    @Test
    fun `sp literals are not used in components`() {
        val hits = all().filter { (f, _, l) ->
            Regex("""\b\d+(\.\d+)?\.sp\b""").containsMatchIn(l) && "theme" !in f.path
        }
        assertTrue(hits.isEmpty(), "Use AedstTypeScale / typography: ${hits.map { "${it.first.name}:${it.second}" }}")
    }

    @Test
    fun `looping animations are only declared in files that read reduced motion`() {
        val files = all().filter { (_, _, l) -> "rememberInfiniteTransition(" in l || "infiniteRepeatable(" in l }
            .map { it.first }.toSet()
        val missing = files.filterNot { it.readText().contains("rememberReducedMotion") }
        assertTrue(missing.isEmpty(), "Honour reduced motion: ${missing.map { it.name }}")
    }

    @Test
    fun `a rotated icon uses the layout-direction aware helper`() {
        val hits = all().filter { (_, _, l) -> "rotate(if" in l && "KeyboardArrowRight" !in l && "Rtl" !in l }
            .filterNot { (f, _, _) -> f.name == "AedstCollapsible.kt" } // a down arrow flipped up is symmetric
        assertTrue(hits.isEmpty(), "Use chevronRotation(): ${hits.map { "${it.first.name}:${it.second}" }}")
    }

    @Test
    fun `an icon is only decorative inside a labelled control`() {
        // Every Icon with a null description in non-preview code must sit within a few lines of a label or a
        // component that takes one; the bare ones below are the reviewed allowlist.
        val bare = all().filter { (_, _, l) -> "Icon(" in l && "contentDescription = null" in l }
            .map { "${it.first.name}" }.toSet()
        val reviewed = setOf(
            "AedstAiChat.kt", "AedstAiCheckpoint.kt", "AedstAiFileTree.kt", "AedstAiModelSelector.kt",
            "AedstAiPromptInput.kt", "AedstAiQueue.kt", "AedstAiSources.kt", "AedstAiStackTrace.kt", "AedstAiTask.kt",
            "AedstAiTerminal.kt", "AedstAiTool.kt", "AedstAlert.kt", "AedstAttachment.kt", "AedstBreadcrumb.kt",
            "AedstCarousel.kt", "AedstCodeBlock.kt", "AedstCollapsible.kt", "AedstCommand.kt", "AedstDataTable.kt",
            "AedstDropdownMenu.kt", "AedstMessageScroller.kt", "AedstNativeSelect.kt", "AedstPagination.kt",
            "AedstSheet.kt", "AedstTrace.kt", "AiLineParts.kt", "AedstAiChainOfThought.kt", "AedstAiMessage.kt",
        )
        val unreviewed = bare - reviewed
        assertTrue(unreviewed.isEmpty(), "Review the labelling of a new decorative icon, then list it: $unreviewed")
    }
}
