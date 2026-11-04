package com.aedst.core.media.upload

import android.content.Context
import androidx.core.app.NotificationChannelCompat
import androidx.core.app.NotificationManagerCompat
import com.aedst.core.common.AppInitializer
import com.aedst.core.media.R
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject

internal const val UPLOAD_CHANNEL_ID = "media_uploads"

/** Low-importance channel for the foreground upload notification (no sound, no heads-up). */
class UploadNotificationChannelInitializer @Inject constructor(@ApplicationContext private val context: Context) :
    AppInitializer {
    override fun initialize() {
        NotificationManagerCompat.from(context).createNotificationChannel(
            NotificationChannelCompat.Builder(UPLOAD_CHANNEL_ID, NotificationManagerCompat.IMPORTANCE_LOW)
                .setName(context.getString(R.string.media_upload_channel_name))
                .build(),
        )
    }
}
