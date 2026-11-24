package com.aedst.core.media.data

import com.aedst.media.v1.MediaServiceClient
import com.aedst.media.v1.MediaServiceClientInterface
import com.connectrpc.ProtocolClientInterface
import dev.zacsweers.metro.AppScope
import dev.zacsweers.metro.BindingContainer
import dev.zacsweers.metro.ContributesTo
import dev.zacsweers.metro.Provides
import dev.zacsweers.metro.SingleIn

/**
 * The generated service client. Everything else this module binds is contributed by its class: the repository by
 * [ConnectMediaRepository], the start-up work and the sign-out hook by their own `@ContributesIntoSet`.
 */
@BindingContainer
@ContributesTo(AppScope::class)
object MediaModule {
    @Provides
    @SingleIn(AppScope::class)
    fun provideMediaServiceClient(client: ProtocolClientInterface): MediaServiceClientInterface =
        MediaServiceClient(client)
}
