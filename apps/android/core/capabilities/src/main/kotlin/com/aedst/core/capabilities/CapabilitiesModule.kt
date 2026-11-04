package com.aedst.core.capabilities

import com.aedst.capabilities.v1.CapabilitiesServiceClient
import com.aedst.capabilities.v1.CapabilitiesServiceClientInterface
import com.aedst.core.common.AedstFeature
import com.aedst.core.common.CapabilitiesState
import com.aedst.core.network.ClientIdentity
import com.connectrpc.ProtocolClientInterface
import dagger.Binds
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
abstract class CapabilitiesModule {

    @Binds
    abstract fun bindCapabilitiesState(impl: CapabilitiesService): CapabilitiesState

    @Binds
    abstract fun bindCapabilitiesRemote(impl: ConnectCapabilitiesRemote): CapabilitiesRemote

    @Binds
    abstract fun bindCapabilitiesCache(impl: DataStoreCapabilitiesCache): CapabilitiesCache

    companion object {
        @Provides
        @Singleton
        fun provideCapabilitiesServiceClient(client: ProtocolClientInterface): CapabilitiesServiceClientInterface =
            CapabilitiesServiceClient(client)

        /** Every feature module linked into the app, and the ones that stay hidden until the server enables them. */
        @Provides
        @Singleton
        fun provideClientBuild(): ClientBuild = ClientBuild(
            platform = ClientIdentity.PLATFORM,
            version = ClientIdentity.version,
            features = setOf(
                AedstFeature.TASKS,
                AedstFeature.MEDIA,
                AedstFeature.SEARCH,
                AedstFeature.ADMIN,
                AedstFeature.NOTIFICATIONS,
                AedstFeature.AUTH,
            ),
            flagged = setOf(AedstFeature.ADMIN),
        )
    }
}
