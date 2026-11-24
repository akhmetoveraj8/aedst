package com.aedst.core.common

import android.util.Log
import dev.zacsweers.metro.AppScope
import dev.zacsweers.metro.ContributesBinding
import dev.zacsweers.metro.Inject
import dev.zacsweers.metro.SingleIn

/** Logcat-backed [Logger]. `debug` is a no-op unless the tag is loggable at DEBUG, so release builds stay quiet. */
@SingleIn(AppScope::class)
@ContributesBinding(AppScope::class)
@Inject
public class LogcatLogger : Logger {
    override fun debug(tag: String, message: String) {
        if (Log.isLoggable(tag, Log.DEBUG)) Log.d(tag, message)
    }

    override fun warn(tag: String, message: String, throwable: Throwable?) {
        Log.w(tag, message, throwable)
    }

    override fun error(tag: String, message: String, throwable: Throwable?) {
        Log.e(tag, message, throwable)
    }
}
