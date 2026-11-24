package com.aedst.core.capabilities

import com.aedst.capabilities.v1.CapabilitiesServiceClient
import com.aedst.capabilities.v1.CapabilitiesServiceClientInterface
import com.aedst.core.common.AedstFeature
import com.aedst.core.network.ClientIdentity
import com.connectrpc.ProtocolClientInterface
import dev.zacsweers.metro.AppScope
import dev.zacsweers.metro.BindingContainer
import dev.zacsweers.metro.ContributesTo
import dev.zacsweers.metro.Provides
import dev.zacsweers.metro.SingleIn

@BindingContainer
@ContributesTo(AppScope::class)
object CapabilitiesModule {

    @Provides
    @SingleIn(AppScope::class)
    fun provideCapabilitiesServiceClient(client: ProtocolClientInterface): CapabilitiesServiceClientInterface =
        CapabilitiesServiceClient(client)

    /** Every feature module linked into the app, and the ones that stay hidden until the server enables them. */
    @Provides
    @SingleIn(AppScope::class)
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
