package com.aedst.core.ui.components

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.height
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.aedst.core.ui.components.support.AedstAiPromptInputFile
import com.aedst.core.ui.components.support.AedstAiPromptInputState

/** AI Elements, batch B: conversation, prompt input and citation parts (web `ai-chat` ... `ai-sources`). */
internal fun kitAiBEntries(): List<CatalogEntry> = listOf(
    CatalogEntry(
        "ai_chat",
        "kit_ai_chat",
        setOf(
            "AedstAiChat",
            "AedstAiChatItem",
            "AedstAiMessage",
            "AedstAiMessageHeader",
            "AedstAiMessageContent",
            "AedstAiMessageResponse",
            "AedstAiMessageActions",
            "AedstAiMessageAction",
        ),
    ) {
        AedstAiChat(modifier = Modifier.height(280.dp), busy = true) {
            item {
                AedstAiChatItem(from = AedstAiMessageRole.USER) {
                    AedstAiMessage(from = AedstAiMessageRole.USER) {
                        AedstAiMessageContent { Text("Why did the build fail?") }
                    }
                }
            }
            item {
                AedstAiChatItem(from = AedstAiMessageRole.ASSISTANT, live = true, busy = true) {
                    AedstAiMessage(
                        from = AedstAiMessageRole.ASSISTANT,
                        header = { AedstAiMessageHeader("Agent") },
                        actions = {
                            AedstAiMessageAction(label = "Copy", onClick = {}) {
                                Icon(Icons.Default.ContentCopy, contentDescription = null)
                            }
                        },
                    ) {
                        AedstAiMessageContent {
                            AedstAiMessageResponse("The lockfile is out of date.", streaming = true)
                        }
                    }
                }
            }
            item {
                AedstAiMessageActions {
                    AedstAiMessageAction(label = "Good response", onClick = {}, pressed = true, tooltip = null) {
                        Icon(Icons.Default.Check, contentDescription = null)
                    }
                }
            }
        }
    },
    CatalogEntry("ai_chat_empty", "kit_ai_chat", setOf("AedstAiChatEmptyState")) {
        Column(modifier = Modifier.height(200.dp)) {
            AedstAiChatEmptyState(
                title = "Start a conversation",
                description = "Ask about your project.",
                icon = { Icon(Icons.Default.AutoAwesome, contentDescription = null) },
            )
        }
    },
    CatalogEntry(
        "ai_prompt_input",
        "kit_ai_input",
        setOf(
            "AedstAiPromptInput", "AedstAiPromptInputHeader", "AedstAiPromptInputAttachButton",
            "AedstAiPromptInputSubmit", "AedstAiModelSelector", "AedstAiModelSelectorTrigger", "AedstAiContext",
            "AedstAiSuggestions", "AedstAiSuggestion",
        ),
    ) {
        Column {
            AedstAiSuggestions {
                AedstAiSuggestion("Summarize this thread", onClick = {})
                AedstAiSuggestion("Draft a reply", onClick = {})
            }
            val state = remember {
                val file = AedstAiPromptInputFile("content://catalog/1", "report.pdf")
                AedstAiPromptInputState(initialFiles = listOf(file))
            }
            AedstAiPromptInput(
                onSubmit = { _, _ -> },
                label = "Message",
                state = state,
                placeholder = "Ask anything",
                onAttachRequest = {},
            ) {
                AedstAiModelSelector(
                    expanded = false,
                    onExpandedChange = {},
                    trigger = { AedstAiModelSelectorTrigger(name = "Fast model", expanded = false, onClick = {}) },
                ) {}
                AedstAiContext(usedTokens = 54_000, maxTokens = 128_000) {}
            }
            AedstAiPromptInputSubmit(status = AedstAiPromptInputStatus.STREAMING, onClick = {}, onStop = {})
        }
    },
    CatalogEntry(
        "ai_model_selector_list",
        "kit_ai_input",
        setOf(
            "AedstAiModelSelectorList",
            "AedstAiModelSelectorGroup",
            "AedstAiModelSelectorItem",
            "AedstAiModelSelectorSeparator",
            "AedstAiModelSelectorShortcut",
            "AedstAiModelSelectorLogo",
            "AedstAiModelSelectorLogoGroup",
            "AedstAiModelSelectorName",
        ),
    ) {
        with(aiModelSelectorScope {}) {
            AedstAiModelSelectorList {
                AedstAiModelSelectorGroup(heading = "Provider") {
                    AedstAiModelSelectorItem(
                        name = "Fast model",
                        selected = true,
                        onSelect = {},
                        logo = {
                            AedstAiModelSelectorLogoGroup {
                                AedstAiModelSelectorLogo { Icon(Icons.Default.AutoAwesome, contentDescription = null) }
                            }
                        },
                        shortcut = "1",
                    )
                    AedstAiModelSelectorItem(name = "Large model", selected = false, onSelect = {})
                }
                AedstAiModelSelectorSeparator()
                AedstAiModelSelectorShortcut("Esc")
                AedstAiModelSelectorName("Effort: high")
            }
        }
    },
    CatalogEntry(
        "ai_context_card",
        "kit_ai_input",
        setOf(
            "AedstAiContextContentHeader",
            "AedstAiContextContentBody",
            "AedstAiContextContentFooter",
            "AedstAiContextInputUsage",
            "AedstAiContextOutputUsage",
            "AedstAiContextReasoningUsage",
            "AedstAiContextCacheUsage",
        ),
    ) {
        val usage = AedstAiContextUsage(inputTokens = 40_000, outputTokens = 9_000, reasoningTokens = 5_000)
        with(aiContextScope(54_000, 128_000, usage)) {
            Column {
                AedstAiContextContentHeader(label = "Context")
                AedstAiContextContentBody {
                    AedstAiContextInputUsage("Input")
                    AedstAiContextOutputUsage("Output")
                    AedstAiContextReasoningUsage("Reasoning")
                    AedstAiContextCacheUsage("Cache")
                }
                AedstAiContextContentFooter { Text("\$0.12") }
            }
        }
    },
    CatalogEntry(
        "ai_confirmation",
        "kit_ai_input",
        setOf(
            "AedstAiConfirmation",
            "AedstAiConfirmationRequest",
            "AedstAiConfirmationAccepted",
            "AedstAiConfirmationRejected",
            "AedstAiConfirmationAction",
        ),
    ) {
        AedstAiConfirmation(
            state = AedstAiConfirmationState.APPROVAL_REQUESTED,
            approval = AedstAiConfirmationApproval(id = "call_1"),
            title = "Delete 3 files",
            description = "The agent wants to delete build outputs.",
            media = {
                AedstAiConfirmationRequest { Icon(Icons.Default.Warning, contentDescription = null) }
                AedstAiConfirmationAccepted { Icon(Icons.Default.Check, contentDescription = null) }
                AedstAiConfirmationRejected { Icon(Icons.Default.Close, contentDescription = null) }
            },
            actions = {
                AedstAiConfirmationAction("Deny", onClick = {}, variant = AedstButtonVariant.OUTLINE)
                AedstAiConfirmationAction("Approve", onClick = {})
            },
        )
    },
    CatalogEntry(
        "ai_citations",
        "kit_ai_sources",
        setOf(
            "AedstAiInlineCitation", "AedstAiInlineCitationText", "AedstAiInlineCitationCard",
            "AedstAiInlineCitationCardTrigger", "AedstAiInlineCitationSource", "AedstAiInlineCitationQuote",
            "AedstAiSources", "AedstAiSourcesTrigger", "AedstAiSourcesContent", "AedstAiSource",
        ),
    ) {
        Column {
            AedstAiInlineCitation {
                AedstAiInlineCitationText("Compose mirrors layouts in right-to-left locales.")
                AedstAiInlineCitationCard(
                    sources = listOf("https://www.example.com/rtl", "https://docs.example.org/i18n"),
                    moreLabel = "and 1 more source",
                ) {}
            }
            AedstAiInlineCitationCardTrigger(sources = listOf("https://example.com"), onClick = {})
            AedstAiInlineCitationSource(
                url = "https://www.example.com/rtl",
                description = "Layout guide",
                onOpen = {},
            )
            AedstAiInlineCitationQuote("Layouts mirror automatically.")
            AedstAiSources(defaultExpanded = true) {
                AedstAiSourcesTrigger(title = "Used 2 sources")
                AedstAiSourcesContent {
                    AedstAiSource(href = "https://www.example.com/guide", title = "Setup guide", onOpen = {})
                    AedstAiSource(href = "https://docs.example.org/api", onOpen = {})
                }
            }
        }
    },
)
