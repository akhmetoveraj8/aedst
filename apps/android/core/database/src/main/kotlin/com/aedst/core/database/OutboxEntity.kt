package com.aedst.core.database

import androidx.room3.Entity
import androidx.room3.Index
import androidx.room3.PrimaryKey

enum class OutboxState {
    /** Waiting to be delivered (possibly after earlier retryable failures). */
    PENDING,

    /** Gave up: permanent error, unknown type, or attempts exhausted. Kept for diagnostics, never retried. */
    FAILED,
}

/**
 * One queued client→server operation awaiting delivery — the on-device counterpart of the server's transactional
 * outbox (docs/content/server/events.md): write locally first, deliver later when the network allows, at-least-once.
 *
 * Because delivery is at-least-once, [id] doubles as the `Idempotency-Key` sent with the request, so a retry after a
 * lost response is de-duplicated by the server (see ADR on idempotency).
 *
 * **Never put secrets or PII in [payload]**: this database is not encrypted (see docs/content/decisions/0013).
 * Tokens live only in `core/security`'s encrypted store.
 */
@Entity(tableName = "outbox", indices = [Index(value = ["state", "createdAtEpochMs"])])
data class OutboxEntity(
    @PrimaryKey val id: String,
    /** Routing key selecting the `OutboxHandler` that knows how to deliver [payload]. */
    val type: String,
    val payload: String,
    val createdAtEpochMs: Long,
    val attempts: Int = 0,
    val state: OutboxState = OutboxState.PENDING,
    /** Exception class name of the last failure; deliberately not the message (which may carry PII). */
    val lastError: String? = null,
)
