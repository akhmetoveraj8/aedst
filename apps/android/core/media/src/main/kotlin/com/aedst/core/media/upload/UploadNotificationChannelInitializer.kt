package com.aedst.core.media.upload

import android.content.Context
import androidx.core.app.NotificationChannelCompat
import androidx.core.app.NotificationManagerCompat
import com.aedst.core.common.AppInitializer
import com.aedst.core.common.ApplicationContext
import com.aedst.core.media.R
import dev.zacsweers.metro.AppScope
import dev.zacsweers.metro.ContributesIntoSet
import dev.zacsweers.metro.Inject
import dev.zacsweers.metro.binding

internal const val UPLOAD_CHANNEL_ID = "media_uploads"

/** Low-importance channel for the foreground upload notification (no sound, no heads-up). */
@ContributesIntoSet(AppScope::class, binding<AppInitializer>())
@Inject
class UploadNotificationChannelInitializer(@ApplicationContext private val context: Context) : AppInitializer {
    override fun initialize() {
        NotificationManagerCompat.from(context).createNotificationChannel(
            NotificationChannelCompat.Builder(UPLOAD_CHANNEL_ID, NotificationManagerCompat.IMPORTANCE_LOW)
                .setName(context.getString(R.string.media_upload_channel_name))
                .build(),
        )
    }
}
