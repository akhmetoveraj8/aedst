package com.aedst.core.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.InsertDriveFile
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Info
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.aedst.core.ui.theme.AedstSpacing

internal val catalogQuestions = listOf(
    AedstQuestionnaireQuestion(
        name = "role",
        title = "What best describes your role?",
        description = "Pick one option.",
        required = true,
        choices = listOf(
            AedstQuestionnaireOption("engineer", "Engineer", description = "Builds and ships software"),
            AedstQuestionnaireOption("designer", "Designer"),
        ),
    ),
    AedstQuestionnaireQuestion(
        name = "topics",
        title = "Which topics interest you?",
        kind = AedstQuestionKind.MULTIPLE_CHOICE,
        choices = listOf(AedstQuestionnaireOption("web", "Web"), AedstQuestionnaireOption("mobile", "Mobile")),
    ),
    AedstQuestionnaireQuestion(
        name = "notes",
        title = "Anything else?",
        kind = AedstQuestionKind.TEXT,
        inputLabel = "Notes",
    ),
)

/** Chat and conversation components (web `message`, `bubble`, `marker`, `attachment`, `message-scroller`). */
internal fun kitChatEntries(): List<CatalogEntry> = listOf(
    CatalogEntry(
        "message_bubble",
        "kit_chat",
        setOf(
            "AedstMessageGroup",
            "AedstMessage",
            "AedstMessageAvatar",
            "AedstMessageHeader",
            "AedstMessageFooter",
            "AedstBubbleGroup",
            "AedstBubble",
            "AedstBubbleReactions",
        ),
    ) {
        AedstMessageGroup {
            AedstMessage(
                avatar = { AedstMessageAvatar { AedstAvatar(initials = "AL", size = AedstAvatarSize.SM) } },
                header = { AedstMessageHeader("Ada") },
            ) {
                AedstBubbleGroup {
                    AedstBubble(variant = AedstBubbleVariant.MUTED) { Text("Did the build pass?") }
                    AedstBubble(
                        variant = AedstBubbleVariant.TINTED,
                        reactions = { AedstBubbleReactions { Text("+2") } },
                    ) { Text("Release is at five.") }
                }
            }
            AedstMessage(align = AedstMessageAlign.END, footer = { AedstMessageFooter { Text("Read") } }) {
                AedstBubble(onClick = {}) { Text("Yes, all green. Open the report") }
            }
        }
    },
    CatalogEntry("bubble_variants", "kit_chat", setOf("AedstBubble")) {
        Column(verticalArrangement = Arrangement.spacedBy(AedstSpacing.sm)) {
            AedstBubbleVariant.entries.forEach { variant ->
                AedstBubble(variant = variant, align = AedstBubbleAlign.entries[variant.ordinal % 2]) {
                    Text(variant.name.lowercase())
                }
            }
        }
    },
    CatalogEntry("marker", "kit_chat", setOf("AedstMarker", "AedstMarkerIcon", "AedstMarkerContent")) {
        Column(verticalArrangement = Arrangement.spacedBy(AedstSpacing.md)) {
            AedstMarkerVariant.entries.forEach { variant ->
                AedstMarker(variant = variant) {
                    if (variant == AedstMarkerVariant.DEFAULT) {
                        AedstMarkerIcon { Icon(Icons.Default.Info, contentDescription = null) }
                    }
                    AedstMarkerContent(variant.name.lowercase())
                }
            }
        }
    },
    CatalogEntry(
        "attachment",
        "kit_chat",
        setOf("AedstAttachment", "AedstAttachmentMedia", "AedstAttachmentAction", "AedstAttachmentGroup"),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(AedstSpacing.sm)) {
            AedstAttachmentState.entries.forEach { state ->
                AedstAttachment(
                    title = "report-${state.name.lowercase()}.pdf",
                    description = "2.4 MB",
                    state = state,
                    media = { AedstAttachmentMedia { Icon(Icons.AutoMirrored.Filled.InsertDriveFile, null) } },
                    actions = {
                        AedstAttachmentAction(onClick = {}, contentDescription = "Remove") {
                            Icon(Icons.Default.Close, contentDescription = null)
                        }
                    },
                )
            }
            AedstAttachmentGroup {
                AedstAttachmentSize.entries.forEach { size ->
                    item {
                        AedstAttachment(
                            title = "photo-${size.name.lowercase()}.jpg",
                            size = size,
                            orientation = AedstAttachmentOrientation.VERTICAL,
                            onClick = {},
                            media = { AedstAttachmentMedia(variant = AedstAttachmentVariant.IMAGE) {} },
                        )
                    }
                }
            }
        }
    },
    CatalogEntry("message_scroller", "kit_chat", setOf("AedstMessageScroller", "AedstMessageScrollerItem")) {
        AedstMessageScroller(modifier = Modifier.height(240.dp)) {
            items(count = 8) { index ->
                AedstMessageScrollerItem(announce = index == 7) {
                    AedstBubble(align = AedstBubbleAlign.entries[index % 2]) { Text("Message ${index + 1}") }
                }
            }
        }
    },
    CatalogEntry(
        "questionnaire",
        "kit_chat_forms",
        setOf("AedstQuestionnaire", "AedstQuestionnaireProgress", "AedstQuestionnaireChoice"),
    ) {
        AedstQuestionnaire(state = rememberAedstQuestionnaireState(catalogQuestions), onSubmit = {})
    },
    CatalogEntry("sizes", "kit_chat_forms", setOf("AedstFieldSet", "AedstFieldLegend")) {
        Column(verticalArrangement = Arrangement.spacedBy(AedstSpacing.md)) {
            AedstCard(size = AedstCardSize.SM) {
                AedstCardHeader { AedstCardTitle("Small card") }
                AedstCardContent { Text("Dense content") }
            }
            FlowRow(horizontalArrangement = Arrangement.spacedBy(AedstSpacing.sm)) {
                AedstSwitch(checked = true, onCheckedChange = {}, label = "Small", size = AedstSwitchSize.SM)
            }
            AedstFieldSet(legend = "Notifications", legendVariant = AedstFieldLegendVariant.LABEL) {
                AedstSelect(
                    options = listOf("Daily", "Weekly"),
                    selected = "Daily",
                    onSelectedChange = {},
                    optionLabel = { it },
                    label = "Digest",
                    size = AedstSelectSize.SM,
                )
                AedstNativeSelect(
                    options = listOf("English", "Arabic"),
                    selected = null,
                    onSelectedChange = {},
                    optionLabel = { it },
                    label = "Language",
                    placeholder = "Choose",
                    size = AedstNativeSelectSize.SM,
                )
            }
            AedstFieldLegend("Legend", modifier = Modifier.padding(top = AedstSpacing.xs))
        }
    },
)
