package com.aedst.feature.notifications.data

import com.aedst.core.common.AppInitializer
import com.aedst.core.common.SignOutHook
import com.aedst.feature.notifications.domain.NotificationsRepository
import com.aedst.feature.notifications.push.PushInitializer
import com.aedst.feature.notifications.push.PushSignOutHook
import com.aedst.notifications.v1.NotificationsServiceClient
import com.aedst.notifications.v1.NotificationsServiceClientInterface
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
internal abstract class NotificationsModule {

    @Binds
    abstract fun bindNotificationsRepository(impl: ConnectNotificationsRepository): NotificationsRepository

    @Binds
    @IntoSet
    abstract fun bindPushInitializer(impl: PushInitializer): AppInitializer

    @Binds
    @IntoSet
    abstract fun bindPushSignOutHook(impl: PushSignOutHook): SignOutHook

    @Binds
    @IntoSet
    abstract fun bindUnreadCountSignOutHook(impl: UnreadCountSignOutHook): SignOutHook

    companion object {
        @Provides
        @Singleton
        fun provideNotificationsServiceClient(client: ProtocolClientInterface): NotificationsServiceClientInterface =
            NotificationsServiceClient(client)
    }
}
