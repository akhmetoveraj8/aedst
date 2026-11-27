package com.aedst.core.ui.a11y

import android.content.Context
import android.graphics.Bitmap
import android.provider.Settings
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Text
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import androidx.test.core.app.ApplicationProvider
import com.aedst.core.ui.components.AedstCarousel
import com.aedst.core.ui.components.AedstLinearProgressIndicator
import com.aedst.core.ui.components.AedstSkeleton
import com.aedst.core.ui.components.AedstSpinner
import com.aedst.core.ui.theme.AedstTheme
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** Reduced motion: the helper reads the system animation scales, and looping or travelling animation stops. */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "en-w411dp-h800dp")
class ReducedMotionTest {

    @get:Rule
    val compose = createComposeRule()

    private val context: Context = ApplicationProvider.getApplicationContext()

    private fun setScales(animator: Float, transition: Float = animator) {
        val resolver = context.contentResolver
        Settings.Global.putFloat(resolver, Settings.Global.ANIMATOR_DURATION_SCALE, animator)
        Settings.Global.putFloat(resolver, Settings.Global.TRANSITION_ANIMATION_SCALE, transition)
    }

    @Test
    fun `motion is on by default and off when an animation scale is 0`() {
        val resolver = context.contentResolver
        setScales(1f)
        assertFalse(readReducedMotion(resolver))
        setScales(0.5f)
        assertFalse(readReducedMotion(resolver))
        setScales(0f, transition = 1f)
        assertTrue(readReducedMotion(resolver))
        setScales(1f, transition = 0f)
        assertTrue(readReducedMotion(resolver))
    }

    @Test
    fun `rememberReducedMotion follows the system setting`() {
        setScales(0f)
        compose.setContent { AedstTheme { Text(if (rememberReducedMotion()) "reduced" else "motion") } }

        compose.onNodeWithText("reduced").assertExists()
    }

    @Test
    fun `an override wins over the system setting`() {
        setScales(0f)
        compose.setContent {
            CompositionLocalProvider(LocalAedstReducedMotion provides false) {
                AedstTheme { Text(if (rememberReducedMotion()) "reduced" else "motion") }
            }
        }

        compose.onNodeWithText("motion").assertExists()
    }

    @Test
    fun `the theme observes the setting and components see a change`() {
        setScales(1f)
        compose.setContent { AedstTheme { Text(if (rememberReducedMotion()) "reduced" else "motion") } }
        compose.onNodeWithText("motion").assertExists()

        setScales(0f)
        compose.waitForIdle()

        compose.onNodeWithText("reduced").assertExists()
    }

    private fun showSkeleton(reduced: Boolean) {
        compose.mainClock.autoAdvance = false
        compose.setContent {
            CompositionLocalProvider(LocalAedstReducedMotion provides reduced) {
                AedstTheme { AedstSkeleton(Modifier.size(width = 400.dp, height = 40.dp).testTag("skeleton")) }
            }
        }
        compose.mainClock.advanceTimeByFrame()
    }

    private fun skeletonImage(): Bitmap =
        compose.onNodeWithTag("skeleton").captureToImage().asAndroidBitmap().copy(Bitmap.Config.ARGB_8888, false)

    @Test
    fun `the skeleton shimmers with motion`() {
        showSkeleton(reduced = false)
        val first = skeletonImage()
        compose.mainClock.advanceTimeBy(300)

        assertFalse("the gradient must travel while motion is on", first.sameAs(skeletonImage()))
    }

    @Test
    fun `the skeleton is a static block under reduced motion`() {
        showSkeleton(reduced = true)
        val first = skeletonImage()
        compose.mainClock.advanceTimeBy(600)

        assertTrue("no looping shimmer under reduced motion", first.sameAs(skeletonImage()))
    }

    private fun transitions(reduced: Boolean): Pair<EnterTransition, ExitTransition> {
        var result: Pair<EnterTransition, ExitTransition>? = null
        compose.setContent {
            CompositionLocalProvider(LocalAedstReducedMotion provides reduced) {
                AedstTheme { result = rememberDisclosureEnter() to rememberDisclosureExit() }
            }
        }
        compose.waitForIdle()
        return checkNotNull(result)
    }

    @Test
    fun `disclosure panels have no enter or exit transition under reduced motion`() {
        val (enter, exit) = transitions(reduced = true)

        assertTrue(enter === EnterTransition.None)
        assertTrue(exit === ExitTransition.None)
    }

    @Test
    fun `disclosure panels animate with motion`() {
        val (enter, exit) = transitions(reduced = false)

        assertFalse(enter === EnterTransition.None)
        assertFalse(exit === ExitTransition.None)
    }

    @Test
    fun `indeterminate progress stays announced as indeterminate under reduced motion`() {
        compose.setContent {
            CompositionLocalProvider(LocalAedstReducedMotion provides true) {
                AedstTheme { AedstLinearProgressIndicator(progress = null, modifier = Modifier.testTag("bar")) }
            }
        }

        compose.onNodeWithTag("bar").assert(
            SemanticsMatcher.expectValue(SemanticsProperties.ProgressBarRangeInfo, ProgressBarRangeInfo.Indeterminate),
        )
    }

    @Test
    fun `the spinner keeps its name under reduced motion`() {
        compose.setContent {
            CompositionLocalProvider(LocalAedstReducedMotion provides true) { AedstTheme { AedstSpinner() } }
        }

        compose.onNodeWithContentDescription("Loading").assertExists()
    }

    @Test
    fun `the carousel jumps to the next slide without scrolling under reduced motion`() {
        compose.setContent {
            CompositionLocalProvider(LocalAedstReducedMotion provides true) {
                AedstTheme { AedstCarousel(pageCount = 3) { index -> Text("Page body ${index + 1}") } }
            }
        }
        compose.mainClock.autoAdvance = false

        compose.onNodeWithContentDescription("Next").performClick()
        compose.mainClock.advanceTimeByFrame()
        compose.mainClock.advanceTimeByFrame()

        compose.onNodeWithText("Slide 2 of 3").assertExists()
    }
}
