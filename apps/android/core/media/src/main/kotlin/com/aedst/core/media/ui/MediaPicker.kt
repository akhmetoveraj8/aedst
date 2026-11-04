package com.aedst.core.media.ui

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState

/**
 * Photo Picker (`ActivityResultContracts.PickMultipleVisualMedia`): no storage permission needed; on devices without
 * the system picker AndroidX falls back to the document picker. Returns a function that opens it.
 *
 * ```
 * val pickMedia = rememberMediaPicker { uris -> uris.forEach { uploads.enqueue(it, taskId) } }
 * AedstButton(text = "Attach", onClick = pickMedia)
 * ```
 */
@Composable
fun rememberMediaPicker(maxItems: Int = DEFAULT_MAX_ITEMS, onPicked: (List<Uri>) -> Unit): () -> Unit {
    val currentOnPicked by rememberUpdatedState(onPicked)
    val contract = remember(maxItems) { ActivityResultContracts.PickMultipleVisualMedia(maxItems) }
    val launcher = rememberLauncherForActivityResult(contract) { uris ->
        if (uris.isNotEmpty()) currentOnPicked(uris)
    }
    return {
        launcher.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageAndVideo))
    }
}

private const val DEFAULT_MAX_ITEMS = 10
