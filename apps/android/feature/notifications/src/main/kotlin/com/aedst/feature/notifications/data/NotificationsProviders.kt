package com.aedst.feature.notifications.data

import com.aedst.notifications.v1.NotificationsServiceClient
import com.aedst.notifications.v1.NotificationsServiceClientInterface
import com.connectrpc.ProtocolClientInterface
import dev.zacsweers.metro.AppScope
import dev.zacsweers.metro.BindingContainer
import dev.zacsweers.metro.ContributesTo
import dev.zacsweers.metro.Provides
import dev.zacsweers.metro.SingleIn

/**
 * The generated service client. The repository, the push initializer and the two sign-out hooks are contributed by
 * their own classes (`@ContributesBinding` / `@ContributesIntoSet`).
 */
@BindingContainer
@ContributesTo(AppScope::class)
object NotificationsProviders {
    @Provides
    @SingleIn(AppScope::class)
    fun provideNotificationsServiceClient(client: ProtocolClientInterface): NotificationsServiceClientInterface =
        NotificationsServiceClient(client)
}
