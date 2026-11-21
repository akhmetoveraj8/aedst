package com.aedst.core.ui.components

import android.content.res.Configuration
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDefaults
import androidx.compose.material3.DisplayMode
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import com.aedst.core.ui.theme.AedstTheme
import kotlinx.coroutines.flow.drop

/**
 * Inline month calendar for picking one date, mirroring web's `calendar.tsx`. Built on Material 3 [DatePicker] in
 * calendar mode without its dialog chrome (localized month names, week start and RTL come from the platform).
 * [onDateSelected] receives the picked day as epoch millis at UTC midnight. For a modal picker use
 * `AedstDatePickerDialog`.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AedstCalendar(selectedDateMillis: Long?, onDateSelected: (Long?) -> Unit, modifier: Modifier = Modifier) {
    val state = rememberDatePickerState(
        initialSelectedDateMillis = selectedDateMillis,
        initialDisplayMode = DisplayMode.Picker,
    )
    val currentOnDateSelected by rememberUpdatedState(onDateSelected)
    LaunchedEffect(state) {
        // drop(1): the initial value is the caller's own, only user picks are reported.
        snapshotFlow { state.selectedDateMillis }.drop(1).collect { currentOnDateSelected(it) }
    }
    DatePicker(
        state = state,
        modifier = modifier,
        title = null,
        headline = null,
        showModeToggle = false,
        colors = DatePickerDefaults.colors(containerColor = MaterialTheme.colorScheme.surface),
    )
}

@Preview(name = "Light", showBackground = true)
@Preview(name = "Dark", uiMode = Configuration.UI_MODE_NIGHT_YES, showBackground = true)
@Composable
private fun AedstCalendarPreview() {
    AedstTheme {
        Surface { AedstCalendar(selectedDateMillis = null, onDateSelected = {}) }
    }
}
