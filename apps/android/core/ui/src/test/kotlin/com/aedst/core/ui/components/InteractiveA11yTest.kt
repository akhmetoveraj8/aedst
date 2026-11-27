package com.aedst.core.ui.components

import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeRight
import androidx.compose.ui.unit.LayoutDirection
import com.aedst.core.testing.assertScreenSemantics
import com.aedst.core.ui.theme.AedstTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Slider, one-time code, snackbar, AI reply and the custom clickable rows (touch target, labels, live regions). */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "en-w411dp-h800dp")
class InteractiveA11yTest {

    @get:Rule
    val compose = createComposeRule()

    @Test
    fun `slider name does not hide the value, which comes from the range info and valueText`() {
        compose.setContent {
            AedstTheme {
                AedstSlider(value = 0.4f, onValueChange = {
                }, contentDescription = "Volume", valueText = { "40 percent" })
            }
        }

        val node = compose.onNodeWithContentDescription("Volume").fetchSemanticsNode()
        assertEquals(listOf("Volume"), node.config.getOrNull(SemanticsProperties.ContentDescription))
        assertEquals("40 percent", node.config.getOrNull(SemanticsProperties.StateDescription))
        assertEquals(0.4f, node.config.getOrNull(SemanticsProperties.ProgressBarRangeInfo)?.current)
    }

    @Test
    fun `slider without valueText leaves the value to the range info`() {
        compose.setContent {
            AedstTheme { AedstSlider(value = 0.4f, onValueChange = {}, contentDescription = "Volume") }
        }

        val node = compose.onNodeWithContentDescription("Volume").fetchSemanticsNode()
        assertNotEquals("40 percent", node.config.getOrNull(SemanticsProperties.StateDescription))
        assertNotNull(node.config.getOrNull(SemanticsProperties.ProgressBarRangeInfo))
    }

    @Test
    fun `swiping toward the end edge lowers the value in right-to-left`() {
        var value by mutableFloatStateOf(0.5f)
        compose.setContent {
            CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Rtl) {
                AedstTheme { AedstSlider(value = value, onValueChange = { value = it }, contentDescription = "Volume") }
            }
        }

        compose.onNodeWithContentDescription("Volume").performTouchInput { swipeRight() }

        assertTrue("value=$value", value < 0.5f)
    }

    @Test
    fun `one-time code is an autofillable field and keeps only digits up to its length`() {
        var code by mutableStateOf("")
        compose.setContent {
            AedstTheme { AedstInputOtp(value = code, onValueChange = { code = it }, label = "Code", length = 4) }
        }

        val node = compose.onNodeWithContentDescription("Code")
        assertNotNull(node.fetchSemanticsNode().config.getOrNull(SemanticsProperties.ContentType))
        node.performTextInput("1a2b3c4d5")

        assertEquals("1234", code)
    }

    @Test
    fun `a masked one-time code is a password field and shows dots`() {
        compose.setContent {
            AedstTheme { AedstInputOtp(value = "12", onValueChange = {}, label = "Code", length = 4, masked = true) }
        }

        val config = compose.onNodeWithContentDescription("Code").fetchSemanticsNode().config
        assertTrue(config.contains(SemanticsProperties.Password))
        compose.onNodeWithText("1").assertDoesNotExist()
    }

    @Test
    fun `snackbar is a polite live region that can be dismissed`() {
        val host = SnackbarHostState()
        compose.setContent {
            AedstTheme {
                LaunchedEffect(Unit) { host.showAedstSnackbar(message = "Saved") }
                AedstSnackbarHost(host)
            }
        }

        compose.onNodeWithText("Saved").assertExists()
        compose.onNode(
            SemanticsMatcher.expectValue(SemanticsProperties.LiveRegion, LiveRegionMode.Polite),
        ).assertExists()
        compose.onNode(SemanticsMatcher.keyIsDefined(SemanticsActions.Dismiss)).assertExists()
    }

    @Test
    fun `an announced reply is a live region only once it stops streaming`() {
        var streaming by mutableStateOf(true)
        compose.setContent {
            AedstTheme { AedstAiMessageResponse(text = "Answer", streaming = streaming, announce = true) }
        }
        val live = SemanticsMatcher.expectValue(SemanticsProperties.LiveRegion, LiveRegionMode.Polite)
        compose.onNode(live).assertDoesNotExist()

        streaming = false
        compose.waitForIdle()

        compose.onNode(live).assertExists()
    }

    @Test
    fun `custom disclosure rows are at least 48dp and labelled`() {
        compose.setContent {
            AedstTheme {
                AedstBreadcrumb(listOf(AedstBreadcrumbItem("Home") {}, AedstBreadcrumbItem("Here")))
                AedstCollapsible(title = "Advanced", expanded = false, onExpandedChange = {}) {}
                AedstTrace(
                    steps = listOf(AedstTraceStep("a", "Step", AedstTraceStatus.SUCCESS, detail = "more")),
                    statusLabel = { it.name },
                )
                AedstCheckbox(checked = false, onCheckedChange = {}, label = "Accept")
                AedstSwitch(checked = false, onCheckedChange = {}, label = "Notify")
                AedstPagination(currentPage = 1, pageCount = 3, onPageChange = {})
            }
        }

        compose.assertScreenSemantics("custom rows")
    }
}
