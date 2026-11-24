package com.aedst.core.security

import android.content.Context
import com.aedst.core.common.ApplicationContext
import com.google.android.play.core.integrity.IntegrityManagerFactory
import com.google.android.play.core.integrity.StandardIntegrityManager
import dev.zacsweers.metro.AppScope
import dev.zacsweers.metro.BindingContainer
import dev.zacsweers.metro.ContributesTo
import dev.zacsweers.metro.Provides
import dev.zacsweers.metro.SingleIn

@BindingContainer
@ContributesTo(AppScope::class)
object SecurityModule {

    @Provides
    @SingleIn(AppScope::class)
    fun provideIntegrityManager(@ApplicationContext context: Context): StandardIntegrityManager =
        IntegrityManagerFactory.createStandard(context)

    @Provides
    fun providePlayIntegrityCloudProject(): PlayIntegrityCloudProject =
        PlayIntegrityCloudProject(BuildConfig.PLAY_INTEGRITY_CLOUD_PROJECT)
}
