package com.aedst.core.ui.components

import androidx.compose.foundation.layout.Column
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertIsNotSelected
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import com.aedst.core.ui.theme.AedstTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Semantics and behaviour of the AI Elements batch A (Robolectric, English resources). */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "en")
class AiElementsATest {

    @get:Rule
    val compose = createComposeRule()

    private fun stateIs(value: String) = SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, value)

    private val isButton = SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.Button)

    @Test
    fun `the header is a disclosure button that shows and hides the steps`() {
        compose.setContent {
            AedstTheme {
                AedstAiChainOfThought {
                    AedstAiChainOfThoughtHeader(title = "Chain of thought", statusLabel = "Done")
                    AedstAiChainOfThoughtContent {
                        AedstAiChainOfThoughtStep(label = "Searched", statusLabel = "Done")
                    }
                }
            }
        }

        compose.onNodeWithText("Chain of thought").assert(isButton).assert(stateIs("Done, Collapsed"))
        compose.onNodeWithText("Searched").assertDoesNotExist()

        compose.onNodeWithText("Chain of thought").performClick()

        compose.onNodeWithText("Chain of thought").assert(stateIs("Done, Expanded"))
        compose.onNodeWithText("Searched").assert(stateIs("Done"))
    }

    @Test
    fun `a controlled line reports the toggle and follows its expanded value`() {
        val reported = mutableListOf<Boolean>()
        compose.setContent {
            AedstTheme {
                AedstAiTool(expanded = false, onExpandedChange = { reported += it }) {
                    AedstAiToolHeader(state = AedstAiToolState.INPUT_STREAMING, title = "Running ls")
                    AedstAiToolContent { AedstAiToolInput(label = "Parameters", input = "{}") }
                }
            }
        }

        compose.onNodeWithText("Running ls").performClick()

        assertEquals(listOf(true), reported)
        compose.onNodeWithText("Parameters").assertDoesNotExist()
    }

    @Test
    fun `reasoning opens while streaming and closes with the finished title`() {
        var isStreaming by mutableStateOf(true)
        compose.setContent {
            AedstTheme {
                AedstAiReasoning(isStreaming = isStreaming) {
                    AedstAiReasoningTrigger(thinkingLabel = "Thinking", thoughtLabel = "Thought for 5 s")
                    AedstAiReasoningContent("Looking at the notes")
                }
            }
        }

        compose.onNodeWithText("Thinking").assertExists()
        compose.onNodeWithText("Looking at the notes").assertExists()

        isStreaming = false
        compose.waitForIdle()

        compose.onNodeWithText("Thought for 5 s")
            .assert(SemanticsMatcher.keyIsDefined(SemanticsProperties.LiveRegion))
        compose.onNodeWithText("Looking at the notes").assertDoesNotExist()
    }

    @Test
    fun `tool sections are headings and the approval buttons call back`() {
        var approved = 0
        var denied = 0
        compose.setContent {
            AedstTheme {
                Column {
                    AedstAiTool(defaultExpanded = true) {
                        AedstAiToolHeader(state = AedstAiToolState.OUTPUT_AVAILABLE, title = "Ran ls")
                        AedstAiToolContent { AedstAiToolInput(label = "Parameters", input = "{}") }
                    }
                    AedstAiToolApproval(
                        title = "Run ls?",
                        approveLabel = "Approve",
                        denyLabel = "Deny",
                        onApprove = { approved++ },
                        onDeny = { denied++ },
                    )
                }
            }
        }

        compose.onNodeWithText("Parameters").assert(SemanticsMatcher.keyIsDefined(SemanticsProperties.Heading))
        compose.onNodeWithText("Approve").performClick()
        compose.onNodeWithText("Deny").performClick()
        assertEquals(1, approved)
        assertEquals(1, denied)
    }

    @Test
    fun `tool states map to the trace status vocabulary`() {
        assertEquals(AedstTraceStatus.RUNNING, AedstAiToolState.INPUT_STREAMING.status)
        assertEquals(AedstTraceStatus.PENDING, AedstAiToolState.APPROVAL_REQUESTED.status)
        assertEquals(AedstTraceStatus.ERROR, AedstAiToolState.OUTPUT_ERROR.status)
        assertEquals(AedstTraceStatus.SKIPPED, AedstAiToolState.OUTPUT_DENIED.status)
        assertEquals(AedstTraceStatus.RUNNING, AedstAiQueueItemStatus.IN_PROGRESS.status)
        assertEquals(AedstTraceStatus.ERROR, AedstAiTestStatus.FAILED.status)
    }

    @Test
    fun `a queue action is named and a checkpoint trigger carries its description`() {
        var removed = 0
        var restored = 0
        compose.setContent {
            AedstTheme {
                Column {
                    AedstAiQueueItem(label = "Write tests") {
                        AedstAiQueueItemActions {
                            AedstAiQueueItemAction("Remove", Icons.Outlined.Delete, onClick = { removed++ })
                        }
                    }
                    AedstAiCheckpoint {
                        AedstAiCheckpointTrigger(
                            text = "Restore",
                            onClick = { restored++ },
                            contentDescription = "Restore to Button renamed",
                        )
                    }
                }
            }
        }

        compose.onNodeWithContentDescription("Remove").performClick()
        compose.onNodeWithContentDescription("Restore to Button renamed").performClick()
        assertEquals(1, removed)
        assertEquals(1, restored)
    }

    @Test
    fun `file tree folders toggle and files expose selection`() {
        val expandedChanges = mutableListOf<Set<String>>()
        val selected = mutableListOf<String>()
        compose.setContent {
            AedstTheme {
                AedstAiFileTree(
                    selectedPath = "README.md",
                    onExpandedChange = { expandedChanges += it },
                    onSelect = { selected += it },
                ) {
                    AedstAiFileTreeFolder(path = "src", name = "src") {
                        AedstAiFileTreeFile(path = "src/a.kt", name = "a.kt")
                    }
                    AedstAiFileTreeFile(path = "README.md", name = "README.md")
                }
            }
        }

        compose.onNodeWithText("a.kt").assertDoesNotExist()
        compose.onNodeWithText("src").assert(stateIs("Collapsed")).performClick()
        compose.onNodeWithText("src").assert(stateIs("Expanded"))
        compose.onNodeWithText("a.kt").assertIsNotSelected().performClick()
        compose.onNodeWithText("README.md").assertIsSelected()

        assertEquals(listOf(setOf("src")), expandedChanges)
        assertEquals(listOf("src/a.kt"), selected)
    }

    @Test
    fun `stack traces parse V8 and Gecko frames and flag dependency frames`() {
        val stack = AedstAiParsedStack.parse(
            "TypeError: boom\n  at render (src/app/page.tsx:12:5)\nrun@https://x.test/a.js:1:2\n" +
                "at node:internal/process:1:1\nat Object.go (node_modules/lib/index.js:3:4)\nnot a frame",
        )

        assertEquals("TypeError: boom", stack.error)
        assertEquals(5, stack.frames.size)
        val app = stack.frames[0]
        assertEquals("render", app.functionName)
        assertEquals("src/app/page.tsx", app.file)
        assertEquals(12, app.line)
        assertEquals(5, app.column)
        assertFalse(app.isInternal)
        assertEquals("https://x.test/a.js", stack.frames[1].file)
        assertTrue(stack.frames[2].isInternal)
        assertTrue(stack.frames[3].isInternal)
        assertNull(stack.frames[4].file)
    }

    @Test
    fun `a streaming terminal opens by itself and its clear button follows the output`() {
        var output by mutableStateOf("Building")
        compose.setContent {
            AedstTheme {
                AedstAiTerminal(output = output, isStreaming = true, onClear = { output = "" }) {
                    AedstAiTerminalHeader {
                        AedstAiTerminalTitle(title = "Running build", modifier = Modifier.weight(1f))
                        AedstAiTerminalActions { AedstAiTerminalClearButton(label = "Clear output") }
                    }
                    AedstAiTerminalContent()
                }
            }
        }

        compose.onNodeWithText("Building", substring = true).assertExists()
        compose.onNodeWithContentDescription("Clear output").assertIsEnabled().performClick()
        compose.onNodeWithContentDescription("Clear output").assertIsNotEnabled()
    }

    @Test
    fun `a terminal without onClear has no clear button`() {
        compose.setContent {
            AedstTheme {
                AedstAiTerminal(output = "") {
                    AedstAiTerminalTitle(title = "Ran build")
                    AedstAiTerminalClearButton(label = "Clear output")
                }
            }
        }

        compose.onNodeWithContentDescription("Clear output").assertDoesNotExist()
    }

    @Test
    fun `test counts ignore running tests except in the total`() {
        val counts = AedstAiTestCounts.of(AedstAiTestStatus.entries)

        assertEquals(AedstAiTestCounts(total = 4, passed = 1, failed = 1, skipped = 1), counts)
    }

    @Test
    fun `a failed test with an error opens to show it and other tests are step lines`() {
        compose.setContent {
            AedstTheme {
                AedstAiTestSuites {
                    AedstAiTest("refunds", AedstAiTestStatus.FAILED, error = "Expected 1", statusLabel = "Failed")
                    AedstAiTest(name = "charges", status = AedstAiTestStatus.PASSED, statusLabel = "Passed")
                }
            }
        }

        compose.onNodeWithText("refunds").assert(isButton).assert(stateIs("Failed, Expanded"))
        compose.onNodeWithText("Expected 1", substring = true).assertExists()
        compose.onNodeWithText("charges").assert(stateIs("Passed"))
    }
}
