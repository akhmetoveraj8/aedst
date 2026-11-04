package com.aedst.core.testing

import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.junit4.ComposeTestRule
import androidx.compose.ui.unit.dp

/** Material and WCAG 2.5.8 / Android guidance: 48 x 48 dp. */
const val MIN_TOUCH_TARGET_DP = 48

/**
 * The accessibility rules that can be evaluated on the semantics tree of a rendered screen, for JVM (Robolectric)
 * tests: every control the user can operate (click or text input) has a touch target of at least [minTouchTargetDp] in
 * both directions and something a screen reader can speak (text, content description or the entered text). Call it
 * after `setContent`, once per interesting state of the screen:
 *
 * ```
 * compose.setContent { AedstTheme { MyScreen(state, onIntent = {}) } }
 * compose.assertScreenSemantics("MyScreen idle")
 * ```
 *
 * The full Accessibility Test Framework run (colour contrast, which needs real rendering) is instrumented only: ATF
 * requires API 34+ and does not work on Robolectric (see `ComponentAccessibilityTest`, `LoginScreenAccessibilityTest`).
 *
 * @param name appears in the failure message so a parameterised or multi-state test says which state failed.
 * @param requireHeading also require at least one node marked as a heading (screens with a title).
 * @param includeTextInputs also check text fields (a field is operable although it has no click action).
 */
fun ComposeTestRule.assertScreenSemantics(
    name: String = "screen",
    minTouchTargetDp: Int = MIN_TOUCH_TARGET_DP,
    requireHeading: Boolean = false,
    includeTextInputs: Boolean = true,
) {
    val operableMatcher = if (includeTextInputs) hasClickAction() or hasSetTextAction() else hasClickAction()
    val operable = onAllNodes(operableMatcher).fetchSemanticsNodes()

    operable.forEach { node ->
        val bounds = node.touchBoundsInRoot
        // Scrolled out of the window, so clipped to nothing: not touchable now, and sized by the same layout as when it is
        // scrolled in. Use a taller window in the test to include it.
        if (bounds.isEmpty) return@forEach
        val widthDp = with(density) { bounds.width.toDp() }
        val heightDp = with(density) { bounds.height.toDp() }
        check(widthDp >= minTouchTargetDp.dp && heightDp >= minTouchTargetDp.dp) {
            "$name: touch target ${widthDp}x$heightDp is below ${minTouchTargetDp}dp at $bounds: ${node.config}"
        }
    }

    val unlabeled = operable.filterNot { it.hasSpokenLabel() }
    check(unlabeled.isEmpty()) {
        "$name: ${unlabeled.size} operable node(s) have no text or content description: ${unlabeled.map { it.config }}"
    }

    if (requireHeading) {
        val headings = onAllNodes(SemanticsMatcher.keyIsDefined(SemanticsProperties.Heading)).fetchSemanticsNodes()
        check(headings.isNotEmpty()) { "$name: no node is marked as a heading" }
    }
}

private fun SemanticsNode.hasSpokenLabel(): Boolean {
    val descriptions = config.getOrNull(SemanticsProperties.ContentDescription).orEmpty()
    val texts = config.getOrNull(SemanticsProperties.Text).orEmpty()
    val editable = config.getOrNull(SemanticsProperties.EditableText)
    return descriptions.any { it.isNotBlank() } || texts.any { it.text.isNotBlank() } || editable != null
}
