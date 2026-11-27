package com.aedst.core.ui.screens

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.core.net.toUri
import com.aedst.core.ui.R
import com.aedst.core.ui.adaptive.AedstWindowSizePreviews
import com.aedst.core.ui.components.AedstButton
import com.aedst.core.ui.components.support.isWebUrl
import com.aedst.core.ui.theme.AedstSpacing
import com.aedst.core.ui.theme.AedstTheme
import java.net.URI
import java.util.Locale

/**
 * Where the "update" button sends the user: the Play Store app via `market://`, falling back to the web listing when
 * no Play Store is installed. Pure functions so they are unit-tested without an Activity. Only these two exact link
 * shapes are ever started ([isTrustedStoreUri]): the package name is validated and the market link is pinned to the
 * Play Store app, so a malformed or hostile package name cannot turn the button into an arbitrary `ACTION_VIEW`.
 */
object PlayStoreLinks {
    private const val PLAY_STORE_PACKAGE = "com.android.vending"
    private const val MARKET_SCHEME = "market"
    private const val MARKET_HOST = "details"
    private const val WEB_HOST = "play.google.com"
    private const val WEB_PATH = "/store/apps/details"
    private val PACKAGE_NAME = Regex("""[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+""")

    fun marketUri(packageName: String): String = "market://details?id=$packageName"

    fun webUri(packageName: String): String = "https://play.google.com/store/apps/details?id=$packageName"

    /** True for a Java-style application id (`com.example.app`): letters, digits, underscore and dots, 2+ segments. */
    fun isValidPackageName(packageName: String): Boolean = PACKAGE_NAME.matches(packageName)

    /**
     * True only for `market://details?id=<package>` and `https://play.google.com/store/apps/details?id=<package>`
     * with a valid package, no extra query, fragment, user info or port. The https shape must also pass [isWebUrl].
     */
    fun isTrustedStoreUri(uri: String): Boolean {
        val parsed = runCatching { URI(uri) }.getOrNull() ?: return false
        val query = parsed.rawQuery.orEmpty()
        val packageName = query.removePrefix("id=")
        val shapeOk = query.startsWith("id=") &&
            isValidPackageName(packageName) &&
            parsed.rawFragment == null &&
            parsed.rawUserInfo == null &&
            parsed.port == -1
        if (!shapeOk) return false
        return when (parsed.scheme?.lowercase(Locale.ROOT)) {
            MARKET_SCHEME -> parsed.host == MARKET_HOST && parsed.rawPath.isNullOrEmpty()
            "https" -> isWebUrl(uri) && parsed.host == WEB_HOST && parsed.rawPath == WEB_PATH
            else -> false
        }
    }

    /** Opens the store listing of [packageName]; returns false when neither the Play app nor a browser can handle it. */
    fun open(context: Context, packageName: String = context.packageName): Boolean =
        listOf(marketUri(packageName), webUri(packageName)).any { uri -> tryStart(context, uri) }

    private fun tryStart(context: Context, uri: String): Boolean {
        if (!isTrustedStoreUri(uri)) return false
        val intent = Intent(Intent.ACTION_VIEW, uri.toUri()).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (uri.startsWith("$MARKET_SCHEME:")) intent.setPackage(PLAY_STORE_PACKAGE)
        return try {
            context.startActivity(intent)
            true
        } catch (@Suppress("SwallowedException") e: ActivityNotFoundException) {
            false
        }
    }
}

/**
 * Blocking screen for `CLIENT_UPGRADE_REQUIRED` (ADR-0009): the server refuses this build, so nothing else is
 * reachable. Shown by `app/` above every other destination, driven by `ClientUpgradeState`.
 */
@Composable
fun UpgradeRequiredScreen(modifier: Modifier = Modifier, onUpdate: () -> Unit = {}) {
    val context = LocalContext.current
    Column(
        modifier = modifier
            .fillMaxSize()
            .safeDrawingPadding()
            .padding(AedstSpacing.lg),
        verticalArrangement = Arrangement.spacedBy(AedstSpacing.md, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            text = stringResource(R.string.aedst_upgrade_title),
            style = MaterialTheme.typography.headlineMedium,
            textAlign = TextAlign.Center,
            modifier = Modifier.semantics { heading() },
        )
        Text(
            text = stringResource(R.string.aedst_upgrade_body),
            style = MaterialTheme.typography.bodyLarge,
            textAlign = TextAlign.Center,
        )
        AedstButton(
            text = stringResource(R.string.aedst_upgrade_action),
            onClick = {
                onUpdate()
                PlayStoreLinks.open(context)
            },
        )
    }
}

@AedstWindowSizePreviews
@Preview(name = "Dark", uiMode = Configuration.UI_MODE_NIGHT_YES, showBackground = true)
@Composable
private fun UpgradeRequiredScreenPreview() {
    AedstTheme {
        UpgradeRequiredScreen()
    }
}
