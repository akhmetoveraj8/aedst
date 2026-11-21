package com.aedst.core.network

import com.google.protobuf.Timestamp
import kotlin.time.Instant

/** `google.protobuf.Timestamp` ⇄ [Instant] for mapping generated messages to domain models. */
fun Timestamp.toInstant(): Instant = Instant.fromEpochSeconds(seconds, nanos)

fun Instant.toTimestamp(): Timestamp =
    Timestamp.newBuilder().setSeconds(epochSeconds).setNanos(nanosecondsOfSecond).build()

/** `null` for an unset (all-zero) timestamp, which is how proto3 represents "absent" when presence is not tracked. */
fun Timestamp.toInstantOrNull(): Instant? = if (seconds == 0L && nanos == 0) null else toInstant()
