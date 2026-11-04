package com.aedst.core.network

import com.connectrpc.Headers
import java.util.UUID

/** Request header the server de-duplicates writes on (1-128 printable ASCII; see the server's `idempotency` package). */
const val IDEMPOTENCY_KEY_HEADER = "Idempotency-Key"

/**
 * Connect request headers carrying [key] as the `Idempotency-Key`. Pass them as the second argument of a generated
 * client call: `client.createTask(request, idempotencyHeaders(item.id))`.
 *
 * Two kinds of caller:
 *  - an outbox handler passes the outbox row id, so every delivery attempt of one queued operation is the same
 *    operation to the server;
 *  - a direct (online) write takes the default, a fresh UUID **per call**: OkHttp's `retryOnConnectionFailure(true)`
 *    silently re-sends a POST whose connection broke, and without a key a lost response could apply the write twice.
 */
fun idempotencyHeaders(key: String = UUID.randomUUID().toString()): Headers =
    mapOf(IDEMPOTENCY_KEY_HEADER to listOf(key))
