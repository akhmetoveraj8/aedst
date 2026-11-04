package com.aedst.core.common

import android.util.Log
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Logging seam for code that must not depend on `android.util.Log` directly
 * (and must stay unit-testable). Never pass tokens, passwords, e-mail
 * addresses or other PII as [message] or [throwable] text.
 */
interface Logger {
    fun debug(tag: String, message: String)
    fun warn(tag: String, message: String, throwable: Throwable? = null)
    fun error(tag: String, message: String, throwable: Throwable? = null)
}

/** Logcat-backed [Logger]. `debug` is a no-op unless the tag is loggable at DEBUG, so release builds stay quiet. */
@Singleton
class LogcatLogger @Inject constructor() : Logger {
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

@Module
@InstallIn(SingletonComponent::class)
abstract class LoggerModule {
    @Binds
    abstract fun bindLogger(impl: LogcatLogger): Logger
}
