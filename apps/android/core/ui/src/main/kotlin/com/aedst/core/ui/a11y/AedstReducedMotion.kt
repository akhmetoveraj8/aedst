package com.aedst.core.ui.a11y

import android.content.ContentResolver
import android.database.ContentObserver
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext

/**
 * Overrides the system "remove animations" preference for a subtree: `true` forces reduced motion, `false` forces
 * motion, `null` (default) reads the system setting. `AedstTheme` provides the observed system value once, so a
 * screen with many skeletons registers one settings observer, not one per skeleton. Tests provide it directly.
 */
val LocalAedstReducedMotion = compositionLocalOf<Boolean?> { null }

/**
 * True when the user asked for no motion ("Remove animations" / animation scales set to 0 in Settings). Components
 * with looping, decorative or travelling animation use it to draw a static frame or switch instantly; the value
 * follows the setting live while the composable is on screen.
 */
@Composable
fun rememberReducedMotion(): Boolean {
    val override = LocalAedstReducedMotion.current
    val system = rememberSystemReducedMotion(observe = override == null)
    return override ?: system
}

/** Reads (and, when [observe], watches) the system animation scales; false when not observing. */
@Composable
internal fun rememberSystemReducedMotion(observe: Boolean): Boolean {
    val resolver = LocalContext.current.contentResolver
    var reduced by remember(resolver, observe) { mutableStateOf(observe && readReducedMotion(resolver)) }
    DisposableEffect(resolver, observe) {
        if (!observe) return@DisposableEffect onDispose {}
        reduced = readReducedMotion(resolver)
        val observer = object : ContentObserver(Handler(Looper.getMainLooper())) {
            override fun onChange(selfChange: Boolean) {
                reduced = readReducedMotion(resolver)
            }
        }
        SCALE_SETTINGS.forEach { name ->
            resolver.registerContentObserver(Settings.Global.getUriFor(name), false, observer)
        }
        onDispose { resolver.unregisterContentObserver(observer) }
    }
    return reduced
}

/** True when the animator or transition scale is 0, the state "Remove animations" (and developer options) set. */
internal fun readReducedMotion(resolver: ContentResolver): Boolean = SCALE_SETTINGS.any { name ->
    Settings.Global.getFloat(resolver, name, 1f) == 0f
}

/** Fade + vertical expand of a disclosure panel, instant under reduced motion. */
@Composable
fun rememberDisclosureEnter(): EnterTransition =
    if (rememberReducedMotion()) EnterTransition.None else fadeIn() + expandVertically()

/** Fade + vertical shrink of a disclosure panel, instant under reduced motion. */
@Composable
fun rememberDisclosureExit(): ExitTransition =
    if (rememberReducedMotion()) ExitTransition.None else fadeOut() + shrinkVertically()

private val SCALE_SETTINGS = listOf(Settings.Global.ANIMATOR_DURATION_SCALE, Settings.Global.TRANSITION_ANIMATION_SCALE)
