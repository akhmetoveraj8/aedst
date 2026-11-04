package com.aedst.core.media.data

import com.aedst.core.common.AppInitializer
import com.aedst.core.common.SignOutHook
import com.aedst.core.media.ui.MediaImageLoaderInitializer
import com.aedst.core.media.ui.MediaSignOutHook
import com.aedst.core.media.upload.UploadNotificationChannelInitializer
import com.aedst.core.media.upload.UploadStagingSweeper
import com.aedst.media.v1.MediaServiceClient
import com.aedst.media.v1.MediaServiceClientInterface
import com.connectrpc.ProtocolClientInterface
import dagger.Binds
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import dagger.multibindings.IntoSet
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
abstract class MediaModule {

    @Binds
    abstract fun bindMediaRepository(impl: ConnectMediaRepository): MediaRepository

    @Binds
    abstract fun bindMediaUploadApi(impl: ConnectMediaRepository): MediaUploadApi

    @Binds
    @IntoSet
    abstract fun bindImageLoaderInitializer(impl: MediaImageLoaderInitializer): AppInitializer

    @Binds
    @IntoSet
    abstract fun bindUploadChannelInitializer(impl: UploadNotificationChannelInitializer): AppInitializer

    @Binds
    @IntoSet
    abstract fun bindUploadStagingSweeper(impl: UploadStagingSweeper): AppInitializer

    @Binds
    @IntoSet
    abstract fun bindMediaSignOutHook(impl: MediaSignOutHook): SignOutHook

    companion object {
        @Provides
        @Singleton
        fun provideMediaServiceClient(client: ProtocolClientInterface): MediaServiceClientInterface =
            MediaServiceClient(client)
    }
}
