package com.aedst.core.ui.components

import android.content.res.Configuration
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Cancel
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.RemoveCircleOutline
import androidx.compose.material.icons.outlined.Circle
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.tooling.preview.Preview
import com.aedst.core.ui.R
import com.aedst.core.ui.a11y.aedstMinTouchHeight
import com.aedst.core.ui.components.support.chevronRotation
import com.aedst.core.ui.theme.AedstDarkPalette
import com.aedst.core.ui.theme.AedstLightPalette
import com.aedst.core.ui.theme.AedstSpacing
import com.aedst.core.ui.theme.AedstTheme
import com.aedst.core.ui.theme.LocalAedstDarkTheme

/** State of one [AedstTraceStep], mirroring web's `trace.tsx` `status` axis. */
enum class AedstTraceStatus {
    PENDING,
    RUNNING,
    SUCCESS,
    ERROR,
    SKIPPED,
}

/**
 * One step of an [AedstTrace]. [duration] is already formatted by the caller ("1.2 s"); [detail] (arguments, output)
 * and [children] are shown when the step is expanded.
 */
class AedstTraceStep(
    val id: String,
    val title: String,
    val status: AedstTraceStatus,
    val duration: String? = null,
    val detail: String? = null,
    val children: List<AedstTraceStep> = emptyList(),
)

/**
 * Collapsible step tree for agent and tool execution traces, mirroring web's `trace.tsx`. A step with a detail or
 * children is a disclosure button (running and failed steps start open). Status is never colour alone: every row
 * shows an icon and the visible, translated text from [statusLabel].
 */
@Composable
fun AedstTrace(steps: List<AedstTraceStep>, statusLabel: (AedstTraceStatus) -> String, modifier: Modifier = Modifier) {
    Column(modifier = modifier.fillMaxWidth()) {
        steps.forEach { step -> TraceItem(step, statusLabel, depth = 0) }
    }
}

@Composable
private fun TraceItem(step: AedstTraceStep, statusLabel: (AedstTraceStatus) -> String, depth: Int) {
    val expandable = step.children.isNotEmpty() || step.detail != null
    var expanded by rememberSaveable(step.id) {
        mutableStateOf(step.status == AedstTraceStatus.RUNNING || step.status == AedstTraceStatus.ERROR)
    }
    val state = stringResource(if (expanded) R.string.aedst_a11y_expanded else R.string.aedst_a11y_collapsed)
    val click = if (expandable) {
        Modifier
            .clickable(role = Role.Button) { expanded = !expanded }
            .semantics { stateDescription = state }
    } else {
        Modifier
    }
    Column {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .then(click)
                .aedstMinTouchHeight()
                .padding(start = AedstSpacing.lg * depth + AedstSpacing.sm, end = AedstSpacing.sm),
            horizontalArrangement = Arrangement.spacedBy(AedstSpacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(modifier = Modifier.size(AedstSpacing.lg)) {
                if (expandable) {
                    Icon(
                        imageVector = Icons.AutoMirrored.Filled.KeyboardArrowRight,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.rotate(chevronRotation(expanded, LocalLayoutDirection.current)),
                    )
                }
            }
            TraceStatusIcon(step.status)
            Text(text = step.title, style = MaterialTheme.typography.labelLarge, modifier = Modifier.weight(1f))
            Text(
                text = listOfNotNull(statusLabel(step.status), step.duration).joinToString(SEPARATOR),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        if (expandable && expanded) {
            if (step.detail != null) {
                Text(
                    text = step.detail,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(
                        start = AedstSpacing.lg * (depth + 1) + AedstSpacing.xxxl,
                        end = AedstSpacing.sm,
                        bottom = AedstSpacing.sm,
                    ),
                )
            }
            step.children.forEach { child -> TraceItem(child, statusLabel, depth + 1) }
        }
    }
}

/** Decorative 16dp icon of a trace [status] (a spinner while running); shared with the AI Elements line parts. */
@Composable
internal fun TraceStatusIcon(status: AedstTraceStatus) {
    val isDark = LocalAedstDarkTheme.current
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    val tint: Color = when (status) {
        AedstTraceStatus.PENDING, AedstTraceStatus.SKIPPED -> muted
        AedstTraceStatus.RUNNING -> if (isDark) AedstDarkPalette.info else AedstLightPalette.info
        AedstTraceStatus.SUCCESS -> if (isDark) AedstDarkPalette.success else AedstLightPalette.success
        AedstTraceStatus.ERROR -> MaterialTheme.colorScheme.error
    }
    val icon = when (status) {
        AedstTraceStatus.PENDING -> Icons.Outlined.Circle
        AedstTraceStatus.SUCCESS -> Icons.Default.CheckCircle
        AedstTraceStatus.ERROR -> Icons.Default.Cancel
        AedstTraceStatus.SKIPPED -> Icons.Default.RemoveCircleOutline
        AedstTraceStatus.RUNNING -> null
    }
    if (icon == null) {
        // The row's status text already says "Running": the spinner itself is decorative.
        CompositionLocalProvider(LocalContentColor provides tint) { AedstSpinner(contentDescription = "") }
    } else {
        Icon(imageVector = icon, contentDescription = null, tint = tint, modifier = Modifier.size(AedstSpacing.lg))
    }
}

private const val SEPARATOR = " · "

@Preview(name = "Light", showBackground = true)
@Preview(name = "Dark", uiMode = Configuration.UI_MODE_NIGHT_YES, showBackground = true)
@Composable
private fun AedstTracePreview() {
    AedstTheme {
        Surface {
            AedstTrace(
                steps = listOf(
                    AedstTraceStep("plan", "Plan", AedstTraceStatus.SUCCESS, duration = "0.4 s"),
                    AedstTraceStep(
                        id = "search",
                        title = "Search",
                        status = AedstTraceStatus.RUNNING,
                        detail = "query: release notes",
                        children = listOf(AedstTraceStep("fetch", "Fetch page", AedstTraceStatus.PENDING)),
                    ),
                    AedstTraceStep("write", "Write answer", AedstTraceStatus.SKIPPED),
                ),
                statusLabel = { it.name.lowercase() },
            )
        }
    }
}
