package com.aedst.core.testing

import kotlin.time.Clock
import kotlin.time.Instant

/** A [Clock] frozen at [epochMillis], for time-dependent logic under test (the `kotlin.time` twin of `Clock.fixed`). */
fun fixedClock(epochMillis: Long): Clock = object : Clock {
    override fun now(): Instant = Instant.fromEpochMilliseconds(epochMillis)
}
