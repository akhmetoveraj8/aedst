package com.aedst.core.ui.components

import android.content.res.Configuration
import androidx.compose.material3.Surface
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.unit.LayoutDirection
import com.aedst.core.ui.theme.AedstTheme
import com.github.takahirom.roborazzi.ExperimentalRoborazziApi
import com.github.takahirom.roborazzi.RoborazziComposeOptions
import com.github.takahirom.roborazzi.captureRoboImage
import com.github.takahirom.roborazzi.fontScale
import com.github.takahirom.roborazzi.locale
import com.github.takahirom.roborazzi.uiMode
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.ParameterizedRobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** The environments every catalog page is rendered in. */
enum class ScreenshotVariant(
    val slug: String,
    val dark: Boolean = false,
    val fontScale: Float = 1f,
    val locale: String = "en",
    val layoutDirection: LayoutDirection = LayoutDirection.Ltr,
) {
    LIGHT("light"),
    DARK("dark", dark = true),

    /** Accessibility font size (200 %): layouts must grow instead of clipping or overlapping. */
    LARGE_FONT("font2x", fontScale = 2f),

    /** Arabic is a supported locale (values-ar): checks mirroring and RTL text. */
    RTL_ARABIC("rtl_ar", locale = "ar", layoutDirection = LayoutDirection.Rtl),
}

/**
 * Golden-image tests for the shared components, one image per (catalog page x [ScreenshotVariant]).
 *
 * Roborazzi only captures/compares when a Roborazzi task enabled it, so a plain `testDebugUnitTest` renders nothing and
 * passes without goldens (`captureRoboImage` returns immediately while `roborazzi.test.record|compare|verify` are all
 * unset). Workflow: `./gradlew :core:ui:recordRoborazziDebug`, commit `core/ui/src/test/snapshots`, CI runs
 * `:core:ui:verifyRoborazziDebug` (see apps/android/README.md).
 */
@OptIn(ExperimentalRoborazziApi::class)
@RunWith(ParameterizedRobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
// A tall virtual phone (411 x 1400 dp @ xhdpi) so a whole catalog page fits in one window without scrolling.
@Config(qualifiers = "w411dp-h1400dp-normal-long-notround-any-320dpi-keyshidden-nonav")
class ComponentScreenshotTest(private val group: String, private val variant: ScreenshotVariant) {

    @Test
    fun `catalog page matches the golden image`() {
        val options = RoborazziComposeOptions {
            uiMode(if (variant.dark) Configuration.UI_MODE_NIGHT_YES else Configuration.UI_MODE_NIGHT_NO)
            locale(variant.locale)
            fontScale(variant.fontScale)
        }

        captureRoboImage(filePath = "$SNAPSHOT_DIR/${group}_${variant.slug}.png", roborazziComposeOptions = options) {
            AedstTheme(useDarkTheme = variant.dark) {
                CompositionLocalProvider(LocalLayoutDirection provides variant.layoutDirection) {
                    Surface { ComponentCatalog.Page(group) }
                }
            }
        }
    }

    companion object {
        /** Relative to the module directory; must equal `roborazzi.outputDir` in core/ui/build.gradle.kts. */
        const val SNAPSHOT_DIR = "src/test/snapshots"

        @JvmStatic
        @ParameterizedRobolectricTestRunner.Parameters(name = "{0}-{1}")
        fun parameters(): Collection<Array<Any>> = ComponentCatalog.groups.keys.flatMap { group ->
            ScreenshotVariant.entries.map { variant -> arrayOf<Any>(group, variant) }
        }
    }
}
