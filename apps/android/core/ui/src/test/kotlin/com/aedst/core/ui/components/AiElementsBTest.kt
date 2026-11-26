package com.aedst.core.ui.components

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.height
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performKeyInput
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.pressKey
import androidx.compose.ui.test.requestFocus
import androidx.compose.ui.test.withKeyDown
import androidx.compose.ui.unit.dp
import com.aedst.core.ui.components.support.AedstAiPromptInputFile
import com.aedst.core.ui.components.support.AedstAiPromptInputState
import com.aedst.core.ui.components.support.AiNumberFormats
import com.aedst.core.ui.components.support.citationHostname
import com.aedst.core.ui.components.support.contextRatio
import com.aedst.core.ui.components.support.isWebUrl
import com.aedst.core.ui.theme.AedstTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.util.Locale

/** Behaviour and semantics of the AI Elements, batch B (Robolectric, English resources). */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "en")
class AiElementsBTest {

    @get:Rule
    val compose = createComposeRule()

    private fun hasState(state: String) = SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, state)

    @Test
    fun `the send button submits the trimmed text and the files, then clears the draft`() {
        val sent = mutableListOf<Pair<String, List<AedstAiPromptInputFile>>>()
        val file = AedstAiPromptInputFile("content://test/1", "report.pdf")
        val state = AedstAiPromptInputState(initialFiles = listOf(file))
        compose.setContent {
            AedstTheme { AedstAiPromptInput(onSubmit = { t, f -> sent += t to f }, label = "Message", state = state) }
        }

        compose.onNodeWithContentDescription("Message").performTextInput("  hello  ")
        compose.onNodeWithContentDescription("Send message").performClick()

        assertEquals(listOf("hello" to listOf(file)), sent)
        assertEquals("", state.text)
        assertTrue(state.files.isEmpty())
        compose.onNodeWithContentDescription("Send message").assertIsNotEnabled()
    }

    @OptIn(ExperimentalTestApi::class)
    @Test
    fun `hardware Enter sends and Shift+Enter does not`() {
        val sent = mutableListOf<String>()
        compose.setContent { AedstTheme { AedstAiPromptInput(onSubmit = { t, _ -> sent += t }, label = "Message") } }
        val field = compose.onNodeWithContentDescription("Message")
        field.performTextInput("first")
        field.requestFocus()

        field.performKeyInput { withKeyDown(Key.ShiftLeft) { pressKey(Key.Enter) } }
        assertTrue(sent.isEmpty())
        field.performKeyInput { pressKey(Key.Enter) }

        assertEquals(1, sent.size)
        assertTrue(sent.single().startsWith("first"))
    }

    @Test
    fun `a busy prompt does not send, and streaming with onStop shows a stop button`() {
        var stops = 0
        val state = AedstAiPromptInputState(initialText = "queued")
        compose.setContent {
            AedstTheme {
                Column {
                    AedstAiPromptInputSubmit(status = AedstAiPromptInputStatus.SUBMITTED, onClick = {}, enabled = false)
                    AedstAiPromptInputSubmit(
                        status = AedstAiPromptInputStatus.STREAMING,
                        onClick = {},
                        onStop = { stops++ },
                    )
                }
            }
        }

        assertFalse(state.canSubmit(busy = true))
        compose.onNodeWithContentDescription("Send message").assert(hasState("Loading")).assertIsNotEnabled()
        compose.onNodeWithContentDescription("Stop").assertIsEnabled().performClick()
        assertEquals(1, stops)
    }

    @Test
    fun `an attachment chip is removed by its named action`() {
        val state = AedstAiPromptInputState(initialFiles = listOf(AedstAiPromptInputFile("content://t/1", "a.pdf")))
        compose.setContent {
            AedstTheme { AedstAiPromptInput(onSubmit = { _, _ -> }, label = "Message", state = state) }
        }

        compose.onNodeWithContentDescription("Remove a.pdf").performClick()

        assertTrue(state.files.isEmpty())
    }

    @Test
    fun `a single-file draft replaces the attached file`() {
        val state = AedstAiPromptInputState(multiple = false)
        state.addFiles(listOf(AedstAiPromptInputFile("u1", "a"), AedstAiPromptInputFile("u2", "b")))
        state.addFiles(listOf(AedstAiPromptInputFile("u3", "c")))

        assertEquals(listOf("c"), state.files.map { it.name })
    }

    @Test
    fun `the context trigger is named with the locale percentage and opens the breakdown`() {
        compose.setContent {
            AedstTheme {
                AedstAiContext(usedTokens = 54_000, maxTokens = 128_000) {
                    AedstAiContextContentHeader(label = "Context")
                }
            }
        }

        compose.onNodeWithContentDescription("Context used: 42%").assert(hasState("Collapsed")).performClick()
        compose.onNodeWithText("54K / 128K").assertExists()
    }

    @Test
    fun `context numbers are formatted for the locale and the ratio is clamped`() {
        val english = AiNumberFormats(Locale.US)

        assertEquals("54K", english.tokens(54_000))
        assertEquals("1.2M", english.tokens(1_200_000))
        assertEquals("42%", english.percent(0.42f))
        assertEquals(1f, contextRatio(usedTokens = 300, maxTokens = 200))
        assertEquals(0f, contextRatio(usedTokens = 10, maxTokens = 0))
    }

    @Test
    fun `a pending confirmation shows its actions and an answered one shows the outcome`() {
        var approved = 0
        compose.setContent {
            AedstTheme {
                Column {
                    AedstAiConfirmation(
                        state = AedstAiConfirmationState.APPROVAL_REQUESTED,
                        approval = AedstAiConfirmationApproval("1"),
                        title = "Run tests",
                        description = "Allow the agent to run the tests?",
                        actions = { AedstAiConfirmationAction("Approve", onClick = { approved++ }) },
                    )
                    AedstAiConfirmation(
                        state = AedstAiConfirmationState.APPROVAL_RESPONDED,
                        approval = AedstAiConfirmationApproval("2", approved = false),
                        title = "Delete files",
                        rejectedText = "You denied this action.",
                        actions = { AedstAiConfirmationAction("Approve again", onClick = {}) },
                    )
                    AedstAiConfirmation(
                        state = AedstAiConfirmationState.APPROVAL_REQUESTED,
                        approval = null,
                        title = "Hidden",
                    )
                }
            }
        }

        compose.onNodeWithText("Approve").performClick()
        assertEquals(1, approved)
        compose.onNodeWithText("You denied this action.").assertExists()
        compose.onNodeWithText("Approve again").assertDoesNotExist()
        compose.onNodeWithText("Hidden").assertDoesNotExist()
    }

    @Test
    fun `a model item is a selected radio button and picking it reports the pick and closes the menu`() {
        var picked = 0
        var closed = 0
        compose.setContent {
            AedstTheme {
                with(aiModelSelectorScope { closed++ }) {
                    AedstAiModelSelectorList {
                        AedstAiModelSelectorItem(name = "Fast model", selected = true, onSelect = { picked++ })
                    }
                }
            }
        }

        compose.onNodeWithText("Fast model")
            .assert(SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.RadioButton))
            .assertIsSelected()
            .performClick()
        assertEquals(1, picked)
        assertEquals(1, closed)
    }

    @Test
    fun `the model trigger exposes the drop-down role and its state`() {
        compose.setContent {
            AedstTheme {
                AedstAiModelSelectorTrigger(name = "Fast model", expanded = true, onClick = {}, label = "Model")
            }
        }

        compose.onNodeWithContentDescription("Model: Fast model")
            .assert(SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.DropdownList))
            .assert(hasState("Expanded"))
    }

    @Test
    fun `a suggestion sends its prompt`() {
        val sent = mutableListOf<String>()
        compose.setContent { AedstTheme { AedstAiSuggestion("Draft a reply", onClick = { sent += it }) } }

        compose.onNodeWithText("Draft a reply").performClick()

        assertEquals(listOf("Draft a reply"), sent)
    }

    @Test
    fun `citation chips and source links are named for screen readers`() {
        val opened = mutableListOf<String>()
        compose.setContent {
            AedstTheme {
                Column {
                    AedstAiInlineCitationCardTrigger(
                        sources = listOf("https://www.example.com/a", "https://b.org"),
                        onClick = {},
                        moreLabel = "and 1 more source",
                    )
                    AedstAiSource(
                        href = "https://www.example.com/guide",
                        title = "Setup guide",
                        onOpen = { opened += it },
                    )
                }
            }
        }

        compose.onNodeWithContentDescription("example.com, and 1 more source").assert(hasState("Collapsed"))
        compose.onNodeWithContentDescription("Setup guide, Opens in browser").performClick()
        assertEquals(listOf("https://www.example.com/guide"), opened)
    }

    @Test
    fun `host names drop www and only web links open by default`() {
        assertEquals("example.com", citationHostname("https://www.example.com/path"))
        assertEquals("not a url", citationHostname("not a url"))
        assertTrue(isWebUrl("https://example.com/x"))
        assertFalse(isWebUrl("intent://scan/#Intent;scheme=zxing;end"))
        assertFalse(isWebUrl("file:///sdcard/secret.txt"))
    }

    @Test
    fun `streaming replies, pressed actions and a busy chat expose their state`() {
        compose.setContent {
            AedstTheme {
                Column {
                    AedstAiChat(modifier = Modifier.height(120.dp), busy = true, label = "Thread") {}
                    AedstAiMessageResponse("Partial reply", streaming = true)
                    AedstAiMessageAction(label = "Good response", onClick = {}, pressed = true, tooltip = null) {}
                }
            }
        }

        compose.onNodeWithText("Partial reply").assert(hasState("Loading"))
        compose.onNodeWithContentDescription("Good response").assertIsSelected()
        // The busy thread and the streaming reply.
        compose.onAllNodes(hasState("Loading")).assertCountEquals(2)
    }
}
