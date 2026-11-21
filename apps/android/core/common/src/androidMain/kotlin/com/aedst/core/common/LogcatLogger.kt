package com.aedst.core.common

import android.util.Log
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Inject
import javax.inject.Singleton

/** Logcat-backed [Logger]. `debug` is a no-op unless the tag is loggable at DEBUG, so release builds stay quiet. */
@Singleton
public class LogcatLogger @Inject constructor() : Logger {
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
public abstract class LoggerModule {
    @Binds
    public abstract fun bindLogger(impl: LogcatLogger): Logger
}
