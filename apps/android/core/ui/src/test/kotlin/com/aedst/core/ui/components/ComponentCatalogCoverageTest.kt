package com.aedst.core.ui.components

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.File

/**
 * Guards the screenshot / semantics / ATF coverage: every public `@Composable` in `components/` must be rendered by
 * [ComponentCatalog] or be listed in [ComponentCatalog.excluded] with a reason, so a new component cannot ship
 * without the checks. Reads the sources (working directory of a unit test is the module directory).
 */
class ComponentCatalogCoverageTest {

    private val publicComposables: Set<String> by lazy {
        val directory = File("src/main/kotlin/com/aedst/core/ui/components")
        assertTrue(directory.isDirectory, "components directory not found from ${File(".").absoluteFile}")
        directory.listFiles { file -> file.extension == "kt" }.orEmpty().flatMapTo(mutableSetOf()) { file ->
            val lines = file.readLines()
            lines.indices.mapNotNull { index ->
                val name = PUBLIC_FUNCTION.matchEntire(lines[index])?.groupValues?.get(1)
                name?.takeIf { isComposable(lines, index) }
            }
        }
    }

    @Test
    fun `every public composable is in the catalog or explicitly excluded`() {
        val missing = publicComposables - ComponentCatalog.covered - ComponentCatalog.excluded.keys

        assertTrue(missing.isEmpty(), "Add to ComponentCatalog (or ComponentCatalog.excluded with a reason): $missing")
    }

    @Test
    fun `catalog and exclusions only name composables that exist`() {
        val stale = (ComponentCatalog.covered + ComponentCatalog.excluded.keys) - publicComposables

        assertTrue(stale.isEmpty(), "Stale catalog names (renamed or removed composables): $stale")
    }

    @Test
    fun `a composable is either covered or excluded, never both`() {
        val both = ComponentCatalog.covered.intersect(ComponentCatalog.excluded.keys)

        assertEquals(emptySet<String>(), both)
    }

    private fun isComposable(lines: List<String>, functionIndex: Int): Boolean {
        var index = functionIndex - 1
        while (index >= 0 && lines[index].startsWith("@")) {
            if (lines[index].startsWith("@Composable")) return true
            index--
        }
        return false
    }

    private companion object {
        /** A top-level, public (no modifier) function whose name is PascalCase and has no receiver. */
        val PUBLIC_FUNCTION = Regex("""fun (?:<[^>]+> )?([A-Z]\w*)\(.*""")
    }
}
