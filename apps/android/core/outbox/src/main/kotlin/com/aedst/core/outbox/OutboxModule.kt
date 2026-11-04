package com.aedst.core.outbox

import com.aedst.core.common.SignOutHook
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import dagger.multibindings.IntoSet
import dagger.multibindings.Multibinds

@Module
@InstallIn(SingletonComponent::class)
abstract class OutboxModule {
    /** Declares the (possibly empty) set that features add [OutboxHandler]s to with `@IntoSet`. */
    @Multibinds
    abstract fun outboxHandlers(): Set<OutboxHandler>

    /** Wipes the queue when the session ends. */
    @Binds
    @IntoSet
    abstract fun bindOutboxSignOutHook(impl: OutboxSignOutHook): SignOutHook
}
