package com.aedst.core.ui.components

import android.os.Build
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.junit4.accessibility.enableAccessibilityChecks
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.test.filters.SdkSuppress
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.Parameterized

/**
 * Runs the Accessibility Test Framework (touch-target size, speakable text, colour contrast, duplicate bounds, ...)
 * over every [ComponentCatalog] entry, light and dark. ATF checks run before each UI action, which is why the test
 * performs a click on the root after composing.
 *
 * Needs API 34+ (the Compose integration is `@RequiresApi(34)` and is unsupported on Robolectric); on older emulators
 * the tests are skipped via an assumption. CI runs API 34 (android-ci.yml, `instrumented`). Window-based components
 * (dialogs, sheets, menus) are listed in [ComponentCatalog.excluded]; the JVM `ComponentSemanticsTest` covers the
 * touch-target and label rules for everything inline on every build.
 */
@OptIn(ExperimentalTestApi::class)
@SdkSuppress(minSdkVersion = Build.VERSION_CODES.UPSIDE_DOWN_CAKE)
@RunWith(Parameterized::class)
class ComponentAccessibilityTest(private val entry: CatalogEntry, private val darkTheme: Boolean) {

    @get:Rule
    val compose = createComposeRule()

    @Before
    fun enableChecks() {
        assumeTrue(
            "Compose accessibility checks need API 34+",
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE,
        )
        compose.enableAccessibilityChecks()
    }

    @Test
    fun passesAccessibilityChecks() {
        compose.setContent { ComponentCatalog.Themed(dark = darkTheme) { entry.content() } }

        compose.onRoot().performClick()
    }

    companion object {
        @JvmStatic
        @Parameterized.Parameters(name = "{0}-dark={1}")
        fun parameters(): Collection<Array<Any>> = ComponentCatalog.entries.flatMap { entry ->
            listOf(false, true).map { dark -> arrayOf<Any>(entry, dark) }
        }
    }
}
