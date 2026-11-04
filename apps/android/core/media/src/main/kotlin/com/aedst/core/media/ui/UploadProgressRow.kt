package com.aedst.core.media.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.aedst.core.media.R
import com.aedst.core.media.upload.UploadProgress
import com.aedst.core.ui.components.AedstLinearProgressIndicator
import com.aedst.core.ui.theme.AedstSpacing

/** One in-flight upload: local thumbnail, state text, progress bar and a cancel button. */
@Composable
fun UploadProgressRow(upload: UploadProgress, onCancel: () -> Unit, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val isVideo = remember(upload.sourceUri) {
        context.contentResolver.getType(upload.sourceUri)?.startsWith("video/") == true
    }
    Row(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(AedstSpacing.md),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        LocalMediaThumbnail(
            uri = upload.sourceUri,
            isVideo = isVideo,
            contentDescription = null,
            modifier = Modifier.size(48.dp), // allow-dp: thumbnail size, not a spacing step
        )
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(AedstSpacing.xs)) {
            Text(text = stringResource(upload.state.labelRes()), style = MaterialTheme.typography.bodyMedium)
            if (upload.state != UploadProgress.State.FAILED) {
                AedstLinearProgressIndicator(progress = upload.fraction, modifier = Modifier.fillMaxWidth())
            }
        }
        if (upload.state != UploadProgress.State.DONE) {
            IconButton(onClick = onCancel) {
                Icon(Icons.Filled.Close, contentDescription = stringResource(R.string.media_upload_cancel))
            }
        }
    }
}

private fun UploadProgress.State.labelRes(): Int = when (this) {
    UploadProgress.State.PREPARING -> R.string.media_upload_preparing
    UploadProgress.State.UPLOADING -> R.string.media_upload_uploading
    UploadProgress.State.FINISHING -> R.string.media_upload_finishing
    UploadProgress.State.DONE -> R.string.media_upload_done
    UploadProgress.State.FAILED -> R.string.media_upload_failed
    UploadProgress.State.CANCELLED -> R.string.media_upload_cancelled
}
