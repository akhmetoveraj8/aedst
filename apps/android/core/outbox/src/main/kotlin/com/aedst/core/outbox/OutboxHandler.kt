package com.aedst.core.outbox

import com.aedst.core.common.Outcome

/** A queued operation as handed to its [OutboxHandler]. */
data class OutboxItem(val id: String, val type: String, val payload: String, val attempts: Int)

/**
 * Delivers one kind of queued operation. Features contribute handlers with
 * `@Binds @IntoSet abstract fun bind(impl: MyHandler): OutboxHandler` in their own Hilt module.
 *
 * Contract:
 *  - Delivery is **at-least-once**: send [OutboxItem.id] as the `Idempotency-Key` header so a retry after a lost
 *    response cannot apply the operation twice.
 *  - Return [Outcome.Failure] with a retryable [com.aedst.core.common.AedstError] (`Network`/`Offline`) to have the
 *    item retried later with backoff; any other error is treated as permanent and the item is parked as `FAILED`.
 *  - Never throw for expected failures; unexpected throwables are treated as permanent.
 */
interface OutboxHandler {
    /** Matches [OutboxItem.type]; unique across handlers. */
    val type: String

    suspend fun deliver(item: OutboxItem): Outcome<Unit>
}
