package com.aedst.core.ui.components

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.LayoutDirection
import com.aedst.core.testing.assertScreenSemantics
import com.aedst.core.ui.components.support.chevronRotation
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.ParameterizedRobolectricTestRunner
import org.robolectric.annotation.Config

/** Every catalog entry in Arabic, right to left: touch targets and spoken labels must hold when mirrored. */
@RunWith(ParameterizedRobolectricTestRunner::class)
// Wide window: the pagination row scrolls, and a clipped end button is not what this test measures.
@Config(qualifiers = "ar-w900dp-h1400dp")
class RtlSemanticsTest(private val entry: CatalogEntry) {

    @get:Rule
    val compose = createComposeRule()

    @Test
    fun `operable nodes meet the touch target and have a label in right-to-left`() {
        compose.setContent {
            CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Rtl) {
                ComponentCatalog.Themed(dark = false) { entry.content() }
            }
        }

        compose.assertScreenSemantics("${entry.id} (rtl)", includeTextInputs = false)
    }

    companion object {
        @JvmStatic
        @ParameterizedRobolectricTestRunner.Parameters(name = "{0}")
        fun parameters(): Collection<Array<Any>> = ComponentCatalog.entries.map { arrayOf<Any>(it) }
    }
}

/** The disclosure chevron is an auto-mirrored arrow: it must turn the other way in right-to-left layouts. */
class ChevronRotationTest {
    @Test
    fun `a closed chevron is not rotated in either direction`() {
        assertEquals(0f, chevronRotation(false, LayoutDirection.Ltr), 0f)
        assertEquals(0f, chevronRotation(false, LayoutDirection.Rtl), 0f)
    }

    @Test
    fun `an open chevron points down in both directions`() {
        assertEquals(90f, chevronRotation(true, LayoutDirection.Ltr), 0f)
        assertEquals(-90f, chevronRotation(true, LayoutDirection.Rtl), 0f)
    }
}
