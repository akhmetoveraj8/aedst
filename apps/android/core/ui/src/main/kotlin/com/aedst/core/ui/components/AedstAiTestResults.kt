package com.aedst.core.ui.components

import android.content.res.Configuration
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Cancel
import androidx.compose.material.icons.outlined.Code
import androidx.compose.material.icons.outlined.Science
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.NonRestartableComposable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import com.aedst.core.ui.components.support.AiCodePanel
import com.aedst.core.ui.theme.AedstSpacing
import com.aedst.core.ui.theme.AedstTheme
import java.text.NumberFormat

/** Result of one test or suite; [status] is its line status. */
enum class AedstAiTestStatus(val status: AedstTraceStatus) {
    PASSED(AedstTraceStatus.SUCCESS),
    FAILED(AedstTraceStatus.ERROR),
    SKIPPED(AedstTraceStatus.SKIPPED),
    RUNNING(AedstTraceStatus.RUNNING),
}

/** Totals for a summary the caller words ("Ran 5 tests, 1 failed"); running tests count only in [total]. */
@Immutable
data class AedstAiTestCounts(val total: Int, val passed: Int, val failed: Int, val skipped: Int) {
    companion object {
        /** Counts [statuses] (web `countTests`). */
        fun of(statuses: Iterable<AedstAiTestStatus>): AedstAiTestCounts {
            val all = statuses.toList()
            return AedstAiTestCounts(
                total = all.size,
                passed = all.count { it == AedstAiTestStatus.PASSED },
                failed = all.count { it == AedstAiTestStatus.FAILED },
                skipped = all.count { it == AedstAiTestStatus.SKIPPED },
            )
        }
    }
}

/** A test run: a summary line that opens into suites and tests (web `ai-test-results.tsx`). Closed by default. */
@Composable
@NonRestartableComposable
fun AedstAiTestResults(
    modifier: Modifier = Modifier,
    expanded: Boolean? = null,
    defaultExpanded: Boolean = false,
    onExpandedChange: ((Boolean) -> Unit)? = null,
    content: @Composable AedstAiDisclosureScope.() -> Unit,
) {
    AedstAiChainOfThought(modifier, expanded, defaultExpanded, onExpandedChange, content)
}

/** The summary line, worded by the caller; a failed or running run shows its status icon, a passed one the flask. */
@Composable
fun AedstAiDisclosureScope.AedstAiTestResultsHeader(
    title: String,
    status: AedstAiTestStatus,
    modifier: Modifier = Modifier,
    statusLabel: String? = null,
    description: String? = null,
    icon: ImageVector = Icons.Outlined.Science,
) {
    val line = status.status.takeUnless { it == AedstTraceStatus.SUCCESS }
    AedstAiChainOfThoughtHeader(title, modifier, line, statusLabel, description, icon)
}

@Composable
@NonRestartableComposable
fun AedstAiDisclosureScope.AedstAiTestResultsContent(
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    AedstAiChainOfThoughtContent(modifier = modifier, content = content)
}

/** Share of passed tests as a progress bar with a visible [label] ("Passed") and the percentage, read as one node. */
@Composable
fun AedstAiTestResultsProgress(counts: AedstAiTestCounts, label: String, modifier: Modifier = Modifier) {
    val fraction = counts.passed.toFloat() / counts.total.coerceAtLeast(1)
    val locale = LocalConfiguration.current.locales[0]
    val percent = remember(locale, fraction) { NumberFormat.getPercentInstance(locale).format(fraction.toDouble()) }
    Column(
        modifier = modifier.fillMaxWidth().padding(horizontal = AedstSpacing.sm).semantics(mergeDescendants = true) {},
        verticalArrangement = Arrangement.spacedBy(AedstSpacing.xs),
    ) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(text = label, style = MaterialTheme.typography.labelMedium)
            Text(
                text = percent,
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        AedstLinearProgressIndicator(progress = fraction)
    }
}

/** The list of [AedstAiTestSuite]s inside [AedstAiTestResultsContent]. */
@Composable
fun AedstAiTestSuites(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Column(modifier = modifier.fillMaxWidth(), content = content)
}

/**
 * A file of tests: [name] with its counts ("payment.test.ts, 2 tests, 1 failed") and its [AedstAiTest]s in [content].
 * A suite with a failure opens by default ([defaultExpanded] overrides).
 */
@Composable
fun AedstAiTestSuite(
    name: String,
    status: AedstAiTestStatus,
    modifier: Modifier = Modifier,
    statusLabel: String? = null,
    defaultExpanded: Boolean? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val line = status.status.takeIf { status == AedstAiTestStatus.FAILED || status == AedstAiTestStatus.RUNNING }
    val isOpenFirst = defaultExpanded ?: (status == AedstAiTestStatus.FAILED)
    AedstAiChainOfThought(modifier = modifier, defaultExpanded = isOpenFirst) {
        AedstAiChainOfThoughtHeader(title = name, status = line, statusLabel = statusLabel, icon = Icons.Outlined.Code)
        AedstAiChainOfThoughtContent { AedstAiChainOfThoughtSteps(content = content) }
    }
}

/**
 * One test. A failed test with an [error] is a collapsible line (open) showing the message as code; any other test
 * is a step line. [duration] is already formatted ("12 ms"); [onCopy] shows the copy button of the error.
 */
@Composable
fun AedstAiTest(
    name: String,
    status: AedstAiTestStatus,
    modifier: Modifier = Modifier,
    error: String? = null,
    duration: String? = null,
    statusLabel: String? = null,
    onCopy: (() -> Unit)? = null,
) {
    if (status == AedstAiTestStatus.FAILED && error != null) {
        AedstAiChainOfThought(modifier = modifier, defaultExpanded = true) {
            AedstAiChainOfThoughtHeader(
                title = name,
                status = AedstTraceStatus.ERROR,
                statusLabel = statusLabel,
                description = duration,
                icon = Icons.Outlined.Cancel,
            )
            AedstAiChainOfThoughtContent { AiCodePanel(code = error, onCopy = onCopy) }
        }
    } else {
        AedstAiChainOfThoughtStep(
            label = name,
            modifier = modifier,
            description = duration,
            status = status.status,
            statusLabel = statusLabel,
        )
    }
}

@Preview(name = "Light", showBackground = true)
@Preview(name = "Dark", uiMode = Configuration.UI_MODE_NIGHT_YES, showBackground = true)
@Composable
private fun AedstAiTestResultsPreview() {
    val statuses = listOf(AedstAiTestStatus.PASSED, AedstAiTestStatus.FAILED, AedstAiTestStatus.SKIPPED)
    AedstTheme {
        Surface {
            AedstAiTestResults(defaultExpanded = true) {
                AedstAiTestResultsHeader(title = "Ran 3 tests, 1 failed", status = AedstAiTestStatus.FAILED)
                AedstAiTestResultsContent {
                    AedstAiTestResultsProgress(counts = AedstAiTestCounts.of(statuses), label = "Passed")
                    AedstAiTestSuites {
                        AedstAiTestSuite(name = "payment.test.ts, 1 failed", status = AedstAiTestStatus.FAILED) {
                            AedstAiTest("charges the card", AedstAiTestStatus.PASSED, duration = "12 ms")
                            AedstAiTest(
                                name = "refunds twice",
                                status = AedstAiTestStatus.FAILED,
                                error = "Expected 1 refund, got 2",
                            )
                            AedstAiTest(name = "retries later", status = AedstAiTestStatus.SKIPPED)
                        }
                    }
                }
            }
        }
    }
}
