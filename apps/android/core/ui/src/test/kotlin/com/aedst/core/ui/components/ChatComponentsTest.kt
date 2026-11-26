package com.aedst.core.ui.components

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.height
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotSelected
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.hasProgressBarRangeInfo
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeDown
import androidx.compose.ui.unit.dp
import com.aedst.core.ui.theme.AedstTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Semantics and behaviour of progress and the conversation components (Robolectric, English resources). */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "en")
class ChatComponentsTest {

    @get:Rule
    val compose = createComposeRule()

    @Test
    fun `determinate progress exposes its value and indeterminate progress exposes none`() {
        compose.setContent {
            AedstTheme {
                Column {
                    AedstLinearProgressIndicator(progress = 0.6f)
                    AedstCircularProgressIndicator(progress = 1.4f)
                    AedstLinearProgressIndicator(progress = null)
                }
            }
        }

        compose.onNode(hasProgressBarRangeInfo(ProgressBarRangeInfo(0.6f, 0f..1f))).assertExists()
        compose.onNode(hasProgressBarRangeInfo(ProgressBarRangeInfo(1f, 0f..1f))).assertExists()
    }

    @Test
    fun `a clickable bubble is a button and reports the press`() {
        var clicks = 0
        compose.setContent { AedstTheme { AedstBubble(onClick = { clicks++ }) { Text("Open the report") } } }

        compose.onNodeWithText("Open the report")
            .assert(SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.Button))
            .performClick()

        assertEquals(1, clicks)
    }

    @Test
    fun `an uploading attachment is busy, a failed one is an error, and its action is named`() {
        var removed = 0
        compose.setContent {
            AedstTheme {
                Column {
                    AedstAttachment(title = "up.pdf", state = AedstAttachmentState.UPLOADING)
                    AedstAttachment(
                        title = "bad.pdf",
                        description = "Upload failed",
                        state = AedstAttachmentState.ERROR,
                        actions = {
                            AedstAttachmentAction(onClick = { removed++ }, contentDescription = "Remove") {
                                Icon(Icons.Default.Close, contentDescription = null)
                            }
                        },
                    )
                }
            }
        }

        compose.onNode(hasProgressBarRangeInfo(ProgressBarRangeInfo.Indeterminate)).assertExists()
        compose.onNode(SemanticsMatcher.expectValue(SemanticsProperties.Error, "Upload failed")).assertExists()
        compose.onNodeWithContentDescription("Remove").performClick()
        assertEquals(1, removed)
    }

    @Test
    fun `marker is read as one item without its decorative icon`() {
        compose.setContent {
            AedstTheme {
                AedstMarker(variant = AedstMarkerVariant.SEPARATOR) {
                    AedstMarkerIcon { Icon(Icons.Default.Close, contentDescription = "hidden") }
                    AedstMarkerContent("Today")
                }
            }
        }

        compose.onNodeWithText("Today").assertExists()
        compose.onNodeWithContentDescription("hidden").assertDoesNotExist()
    }

    @Test
    fun `message scroller opens at the end and offers scroll to end after scrolling up`() {
        lateinit var state: AedstMessageScrollerState
        compose.setContent {
            AedstTheme {
                state = rememberAedstMessageScrollerState()
                AedstMessageScroller(modifier = Modifier.height(200.dp), state = state) {
                    items(count = 30) { index -> AedstMessageScrollerItem { Text("Message $index") } }
                }
            }
        }
        compose.waitForIdle()
        compose.onNodeWithText("Message 29").assertIsDisplayed()
        compose.onNodeWithContentDescription("Scroll to end").assertDoesNotExist()

        compose.onNodeWithContentDescription("Messages").performTouchInput { swipeDown() }
        compose.waitForIdle()
        assertFalse(state.isFollowing)
        compose.onNodeWithContentDescription("Scroll to end").performClick()
        compose.waitForIdle()

        compose.onNodeWithText("Message 29").assertIsDisplayed()
        assertTrue(state.isFollowing)
    }

    @Test
    fun `questionnaire blocks a required question, then steps, skips and submits the answers`() {
        var submitted: Map<String, List<String>>? = null
        compose.setContent {
            AedstTheme {
                AedstQuestionnaire(
                    state = rememberAedstQuestionnaireState(catalogQuestions),
                    onSubmit = { submitted = it },
                )
            }
        }
        compose.onNodeWithText("Question 1 of 3").assertExists()

        compose.onNodeWithText("Next").performClick()
        compose.onNodeWithText("Required").assertExists()

        compose.onNodeWithText("Engineer").performClick()
        compose.onNodeWithText("Engineer").assertIsSelected()
        compose.onNodeWithText("Designer").assertIsNotSelected()
        compose.onNodeWithText("Next").performClick()
        compose.onNodeWithText("Question 2 of 3").assertExists()

        compose.onNodeWithText("Skip").performClick()
        compose.onNodeWithText("Notes").performTextInput("Thanks")
        compose.onNodeWithText("Submit").performClick()

        assertEquals(mapOf("role" to listOf("engineer"), "notes" to listOf("Thanks")), submitted)
    }

    @Test
    fun `the live assistant turn holds its announcement back while the chat is busy`() {
        var busy by mutableStateOf(true)
        compose.setContent {
            AedstTheme {
                AedstAiChat(modifier = Modifier.height(240.dp), busy = busy) {
                    item {
                        AedstAiChatItem(from = AedstAiMessageRole.ASSISTANT, live = true, busy = busy) {
                            Text("Reply")
                        }
                    }
                }
            }
        }
        val liveRegion = SemanticsMatcher.keyIsDefined(SemanticsProperties.LiveRegion)

        compose.onAllNodes(liveRegion).assertCountEquals(0)
        busy = false
        compose.waitForIdle()
        compose.onAllNodes(liveRegion).assertCountEquals(1)
    }
}
