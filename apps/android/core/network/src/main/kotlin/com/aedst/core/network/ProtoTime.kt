package com.aedst.core.network

import com.google.protobuf.Timestamp
import java.time.Instant

/** `google.protobuf.Timestamp` ⇄ [Instant] for mapping generated messages to domain models. */
fun Timestamp.toInstant(): Instant = Instant.ofEpochSecond(seconds, nanos.toLong())

fun Instant.toTimestamp(): Timestamp = Timestamp.newBuilder().setSeconds(epochSecond).setNanos(nano).build()

/** `null` for an unset (all-zero) timestamp, which is how proto3 represents "absent" when presence is not tracked. */
fun Timestamp.toInstantOrNull(): Instant? = if (seconds == 0L && nanos == 0) null else toInstant()
