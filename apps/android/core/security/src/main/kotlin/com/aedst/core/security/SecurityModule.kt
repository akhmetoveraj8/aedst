package com.aedst.core.security

import android.content.Context
import com.google.android.play.core.integrity.IntegrityManagerFactory
import com.google.android.play.core.integrity.StandardIntegrityManager
import dagger.Binds
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
abstract class SecurityModule {

    @Binds
    abstract fun bindEncryptedPreferences(impl: TinkEncryptedPreferences): EncryptedPreferences

    @Binds
    abstract fun bindIntegrityFacade(impl: PlayIntegrityFacade): IntegrityFacade

    companion object {
        @Provides
        @Singleton
        fun provideIntegrityManager(@ApplicationContext context: Context): StandardIntegrityManager =
            IntegrityManagerFactory.createStandard(context)

        @Provides
        fun providePlayIntegrityCloudProject(): PlayIntegrityCloudProject =
            PlayIntegrityCloudProject(BuildConfig.PLAY_INTEGRITY_CLOUD_PROJECT)
    }
}
