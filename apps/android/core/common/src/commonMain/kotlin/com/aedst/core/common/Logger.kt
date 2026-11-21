package com.aedst.core.common

/**
 * Logging seam for code that must not depend on a platform logger directly (and must stay unit-testable). Never pass
 * tokens, passwords, e-mail addresses or other PII as `message` or `throwable` text. Android binds `LogcatLogger`
 * (`androidMain`).
 */
public interface Logger {
    public fun debug(tag: String, message: String)
    public fun warn(tag: String, message: String, throwable: Throwable? = null)
    public fun error(tag: String, message: String, throwable: Throwable? = null)
}
