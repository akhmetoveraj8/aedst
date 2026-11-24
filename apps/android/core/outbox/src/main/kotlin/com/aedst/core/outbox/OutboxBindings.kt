package com.aedst.core.outbox

import dev.zacsweers.metro.AppScope
import dev.zacsweers.metro.ContributesTo
import dev.zacsweers.metro.Multibinds

/** Declares the (possibly empty) set that features add [OutboxHandler]s to with `@ContributesIntoSet`. */
@ContributesTo(AppScope::class)
interface OutboxBindings {
    @Multibinds(allowEmpty = true)
    val outboxHandlers: Set<OutboxHandler>
}
