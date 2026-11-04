package com.aedst.core.ui.components

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.SheetState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import com.aedst.core.ui.theme.AedstRadius
import com.aedst.core.ui.theme.AedstSpacing
import com.aedst.core.ui.theme.AedstTheme

/**
 * Modal bottom sheet primitive, mirroring web's `sheet.tsx` (bottom side). Thin wrapper over
 * Material3's [ModalBottomSheet] with AEDST theming for its inner content column.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AedstBottomSheet(
    onDismissRequest: () -> Unit,
    modifier: Modifier = Modifier,
    sheetState: SheetState = rememberModalBottomSheetState(),
    content: @Composable ColumnScope.() -> Unit,
) {
    ModalBottomSheet(
        onDismissRequest = onDismissRequest,
        modifier = modifier,
        sheetState = sheetState,
        containerColor = MaterialTheme.colorScheme.surface,
        contentColor = MaterialTheme.colorScheme.onSurface,
        shape = RoundedCornerShape(topStart = AedstRadius.xxl, topEnd = AedstRadius.xxl),
    ) {
        Column(
            modifier = Modifier.padding(
                start = AedstSpacing.xl,
                end = AedstSpacing.xl,
                bottom = AedstSpacing.xxl,
            ),
            content = content,
        )
    }
}

/** Preview-only content for [AedstBottomSheetContentPreview]; a real [ModalBottomSheet] cannot be statically previewed. */
@Composable
private fun AedstBottomSheetPreviewContent() {
    Column {
        Text("Share task", style = MaterialTheme.typography.titleMedium)
        Text(
            "Choose where you'd like to share this task.",
            style = MaterialTheme.typography.bodyMedium,
        )
    }
}

/** Renders just the sheet's inner [Column], per the preview convention for overlay components. */
@Composable
fun AedstBottomSheetContentPreview(modifier: Modifier = Modifier) {
    Column(modifier = modifier.padding(AedstSpacing.xl)) {
        AedstBottomSheetPreviewContent()
    }
}

@Preview(name = "Light", showBackground = true)
@Preview(name = "Dark", showBackground = true, uiMode = android.content.res.Configuration.UI_MODE_NIGHT_YES)
@Composable
private fun AedstBottomSheetPreview() {
    AedstTheme {
        Surface(color = MaterialTheme.colorScheme.surface) {
            AedstBottomSheetContentPreview()
        }
    }
}
