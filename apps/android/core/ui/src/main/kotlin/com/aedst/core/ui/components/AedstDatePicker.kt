package com.aedst.core.ui.components

import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import com.aedst.core.ui.R
import com.aedst.core.ui.theme.AedstTheme

/**
 * Modal date picker dialog wrapping Material3's [DatePicker]. Confirming reports the selected
 * date as epoch millis (UTC); dismissing without a selection reports `null`.
 */
@Composable
fun AedstDatePickerDialog(
    onDateSelected: (Long?) -> Unit,
    onDismissRequest: () -> Unit,
    modifier: Modifier = Modifier,
    initialSelectedDateMillis: Long? = null,
) {
    val state = rememberDatePickerState(initialSelectedDateMillis = initialSelectedDateMillis)

    DatePickerDialog(
        modifier = modifier,
        onDismissRequest = onDismissRequest,
        confirmButton = {
            TextButton(onClick = { onDateSelected(state.selectedDateMillis) }) {
                Text(stringResource(R.string.aedst_action_ok))
            }
        },
        dismissButton = {
            TextButton(onClick = onDismissRequest) {
                Text(stringResource(R.string.aedst_action_cancel))
            }
        },
    ) {
        DatePicker(state = state)
    }
}

@Preview(name = "Light", showBackground = true)
@Preview(name = "Dark", uiMode = android.content.res.Configuration.UI_MODE_NIGHT_YES, showBackground = true)
@Composable
private fun AedstDatePickerDialogPreview() {
    AedstTheme {
        Surface {
            AedstDatePickerDialog(
                onDateSelected = {},
                onDismissRequest = {},
            )
        }
    }
}
