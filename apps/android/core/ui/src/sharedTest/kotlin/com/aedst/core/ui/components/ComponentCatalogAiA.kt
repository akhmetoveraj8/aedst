package com.aedst.core.ui.components

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.Icon
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

internal const val CATALOG_STACK =
    "TypeError: Cannot read properties of undefined\n" +
        "at render (src/app/page.tsx:12:5)\n" +
        "at Object.run (node_modules/react-dom/client.js:100:3)\n" +
        "at node:internal/process:1:1"

/** AI Elements, batch A: the collapsible agent-activity lines (web `ai-chain-of-thought` and the parts built on it). */
internal fun kitAiAEntries(): List<CatalogEntry> = listOf(
    CatalogEntry(
        "ai_chain_of_thought",
        "kit_ai_lines",
        setOf(
            "AedstAiChainOfThought",
            "AedstAiChainOfThoughtHeader",
            "AedstAiChainOfThoughtContent",
            "AedstAiChainOfThoughtSteps",
            "AedstAiChainOfThoughtStep",
            "AedstAiChainOfThoughtSearchResults",
            "AedstAiChainOfThoughtSearchResult",
            "AedstAiChainOfThoughtImage",
        ),
    ) {
        AedstAiChainOfThought(defaultExpanded = true) {
            AedstAiChainOfThoughtHeader(title = "Chain of thought", description = "4 s")
            AedstAiChainOfThoughtContent {
                AedstAiChainOfThoughtSteps {
                    AedstAiChainOfThoughtStep(label = "Searched the web", icon = Icons.Outlined.Search) {
                        AedstAiChainOfThoughtSearchResults { AedstAiChainOfThoughtSearchResult("react.dev") }
                    }
                    AedstAiChainOfThoughtStep(label = "Looked at a chart") {
                        AedstAiChainOfThoughtImage(caption = "Revenue by month") {
                            Box(modifier = Modifier.size(64.dp), contentAlignment = Alignment.Center) {
                                Icon(Icons.Outlined.Image, contentDescription = null)
                            }
                        }
                    }
                    AedstAiChainOfThoughtStep(
                        label = "Writing the answer",
                        status = AedstTraceStatus.RUNNING,
                        statusLabel = "Running",
                    )
                }
            }
        }
    },
    CatalogEntry(
        "ai_reasoning_plan_task",
        "kit_ai_lines",
        setOf(
            "AedstAiReasoning", "AedstAiReasoningTrigger", "AedstAiReasoningContent",
            "AedstAiPlan", "AedstAiPlanHeader", "AedstAiPlanTrigger", "AedstAiPlanAction", "AedstAiPlanContent",
            "AedstAiPlanDescription", "AedstAiPlanSteps", "AedstAiPlanStep", "AedstAiPlanFooter",
            "AedstAiTask", "AedstAiTaskTrigger", "AedstAiTaskContent", "AedstAiTaskItem", "AedstAiTaskItemFile",
        ),
    ) {
        Column {
            AedstAiReasoning(isStreaming = true) {
                AedstAiReasoningTrigger(thinkingLabel = "Thinking", thoughtLabel = "Thought for 5 s")
                AedstAiReasoningContent("First I look at the release notes.")
            }
            AedstAiPlan {
                AedstAiPlanHeader {
                    AedstAiPlanTrigger(title = "Plan", description = "1 of 2 done", modifier = Modifier.weight(1f))
                    AedstAiPlanAction {
                        AedstButton(text = "Edit", onClick = {}, variant = AedstButtonVariant.GHOST)
                    }
                }
                AedstAiPlanContent {
                    AedstAiPlanDescription("Rename the button.")
                    AedstAiPlanSteps {
                        AedstAiPlanStep(label = "Find every usage")
                        AedstAiPlanStep(label = "Run the tests", status = AedstTraceStatus.PENDING)
                    }
                    AedstAiPlanFooter { AedstButton(text = "Run plan", onClick = {}) }
                }
            }
            AedstAiTask {
                AedstAiTaskTrigger(title = "Found 1 file")
                AedstAiTaskContent {
                    AedstAiTaskItem(label = "Read") { AedstAiTaskItemFile("src/button.tsx") }
                }
            }
        }
    },
    CatalogEntry(
        "ai_tool_subagent",
        "kit_ai_lines",
        setOf(
            "AedstAiTool", "AedstAiToolHeader", "AedstAiToolContent", "AedstAiToolInput", "AedstAiToolOutput",
            "AedstAiToolApproval", "AedstAiSubagent", "AedstAiSubagentTrigger", "AedstAiSubagentContent",
            "AedstAiSubagentTask", "AedstAiSubagentMeta", "AedstAiSubagentModel", "AedstAiSubagentTools",
            "AedstAiSubagentSteps", "AedstAiSubagentStep",
        ),
    ) {
        Column {
            AedstAiTool(defaultExpanded = true) {
                AedstAiToolHeader(state = AedstAiToolState.OUTPUT_ERROR, title = "Failed to run ls")
                AedstAiToolContent {
                    AedstAiToolInput(label = "Parameters", input = "{ \"path\": \"src\" }", onCopy = {})
                    AedstAiToolOutput(label = "Result", errorText = "ENOENT: no such directory")
                }
            }
            AedstAiToolApproval(
                title = "Run ls -la?",
                approveLabel = "Approve",
                denyLabel = "Deny",
                onApprove = {},
                onDeny = {},
            )
            AedstAiSubagent(defaultExpanded = true) {
                AedstAiSubagentTrigger(title = "Ran the research agent", description = "12 s")
                AedstAiSubagentContent {
                    AedstAiSubagentTask("Find the most cited paper.")
                    AedstAiSubagentMeta {
                        AedstAiSubagentModel(label = "Model", model = "research-1")
                        AedstAiSubagentTools(label = "Tools", tools = listOf("web_search"))
                    }
                    AedstAiSubagentSteps { AedstAiSubagentStep(label = "Searched the web") }
                }
            }
        }
    },
    CatalogEntry(
        "ai_queue_checkpoint_files",
        "kit_ai_dev",
        setOf(
            "AedstAiQueue", "AedstAiQueueSection", "AedstAiQueueSectionTrigger", "AedstAiQueueSectionContent",
            "AedstAiQueueList", "AedstAiQueueItem", "AedstAiQueueItemActions", "AedstAiQueueItemAction",
            "AedstAiCheckpoint", "AedstAiCheckpointIcon", "AedstAiCheckpointTrigger",
            "AedstAiFileTree", "AedstAiFileTreeFolder", "AedstAiFileTreeFile", "AedstAiFileTreeIcon",
            "AedstAiFileTreeName", "AedstAiFileTreeActions",
        ),
    ) {
        Column {
            AedstAiQueue {
                AedstAiQueueSection {
                    AedstAiQueueSectionTrigger(label = "1 to do")
                    AedstAiQueueSectionContent {
                        AedstAiQueueList {
                            AedstAiQueueItem(label = "Write the tests", status = AedstAiQueueItemStatus.IN_PROGRESS) {
                                AedstAiQueueItemActions {
                                    AedstAiQueueItemAction(label = "Remove", icon = Icons.Outlined.Delete, onClick = {})
                                }
                            }
                            AedstAiQueueItem(label = "Read the issue", status = AedstAiQueueItemStatus.COMPLETED)
                        }
                    }
                }
            }
            AedstAiCheckpoint {
                AedstAiCheckpointIcon()
                AedstMarkerContent("Button renamed")
                AedstAiCheckpointTrigger(
                    text = "Restore",
                    onClick = {},
                    contentDescription = "Restore to Button renamed",
                )
            }
            AedstAiFileTree(defaultExpanded = setOf("src"), selectedPath = "src/a.kt", onSelect = {}) {
                AedstAiFileTreeFolder(path = "src", name = "src") {
                    AedstAiFileTreeFile(path = "src/a.kt", name = "a.kt") {
                        AedstAiFileTreeActions { AedstBadge(text = "M") }
                    }
                }
                AedstAiFileTreeFile(path = "README.md", name = "README.md")
                AedstAiFileTreeIcon(Icons.Outlined.Search)
                AedstAiFileTreeName("standalone.txt")
            }
        }
    },
    CatalogEntry(
        "ai_stack_terminal_tests",
        "kit_ai_dev",
        setOf(
            "AedstAiStackTrace", "AedstAiStackTraceHeader", "AedstAiStackTraceContent", "AedstAiStackTraceError",
            "AedstAiStackTraceFrames", "AedstAiTerminal", "AedstAiTerminalHeader", "AedstAiTerminalTitle",
            "AedstAiTerminalActions", "AedstAiTerminalClearButton", "AedstAiTerminalContent",
            "AedstAiTestResults", "AedstAiTestResultsHeader", "AedstAiTestResultsContent", "AedstAiTestResultsProgress",
            "AedstAiTestSuites", "AedstAiTestSuite", "AedstAiTest",
        ),
    ) {
        val stack = AedstAiParsedStack.parse(CATALOG_STACK)
        Column {
            AedstAiStackTrace {
                AedstAiStackTraceHeader(title = "Failed: ${stack.error}")
                AedstAiStackTraceContent {
                    AedstAiStackTraceError(stack.error)
                    AedstAiStackTraceFrames(frames = stack.frames, internalFramesLabel = "2 framework frames")
                }
            }
            AedstAiTerminal(output = "> pnpm build\nDone", onClear = {}, defaultExpanded = true) {
                AedstAiTerminalHeader {
                    AedstAiTerminalTitle(title = "Ran pnpm build", modifier = Modifier.weight(1f))
                    AedstAiTerminalActions { AedstAiTerminalClearButton(label = "Clear output") }
                }
                AedstAiTerminalContent(onCopy = {})
            }
            val statuses = listOf(AedstAiTestStatus.PASSED, AedstAiTestStatus.FAILED)
            AedstAiTestResults(defaultExpanded = true) {
                AedstAiTestResultsHeader(title = "Ran 2 tests, 1 failed", status = AedstAiTestStatus.FAILED)
                AedstAiTestResultsContent {
                    AedstAiTestResultsProgress(counts = AedstAiTestCounts.of(statuses), label = "Passed")
                    AedstAiTestSuites {
                        AedstAiTestSuite(name = "payment.test.ts", status = AedstAiTestStatus.FAILED) {
                            AedstAiTest("charges the card", AedstAiTestStatus.PASSED, duration = "12 ms")
                            AedstAiTest("refunds", AedstAiTestStatus.FAILED, error = "Expected 1, got 2")
                        }
                    }
                }
            }
        }
    },
)
