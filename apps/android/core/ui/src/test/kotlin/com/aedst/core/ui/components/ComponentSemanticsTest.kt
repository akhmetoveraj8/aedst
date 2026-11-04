package com.aedst.core.ui.components

import androidx.compose.ui.test.junit4.createComposeRule
import com.aedst.core.testing.assertScreenSemantics
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.ParameterizedRobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * JVM accessibility checks over every [ComponentCatalog] entry: the subset of the Accessibility Test Framework rules
 * that can be evaluated on the semantics tree (touch-target size, speakable label). The full ATF run (including colour
 * contrast, which needs real rendering) is `ComponentAccessibilityTest` in androidTest: ATF requires API 34+ and
 * explicitly does not work on Robolectric.
 */
@RunWith(ParameterizedRobolectricTestRunner::class)
@Config(qualifiers = "en")
class ComponentSemanticsTest(private val entry: CatalogEntry) {

    @get:Rule
    val compose = createComposeRule()

    @Test
    fun `operable nodes meet the 48dp touch target and have a spoken label`() {
        compose.setContent { ComponentCatalog.Themed(dark = false) { entry.content() } }

        compose.assertScreenSemantics(entry.id, includeTextInputs = false)
    }

    companion object {
        @JvmStatic
        @ParameterizedRobolectricTestRunner.Parameters(name = "{0}")
        fun parameters(): Collection<Array<Any>> = ComponentCatalog.entries.map { arrayOf<Any>(it) }
    }
}
