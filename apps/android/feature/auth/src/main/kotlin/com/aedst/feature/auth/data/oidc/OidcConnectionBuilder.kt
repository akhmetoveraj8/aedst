package com.aedst.feature.auth.data.oidc

import android.net.Uri
import net.openid.appauth.connectivity.ConnectionBuilder
import net.openid.appauth.connectivity.DefaultConnectionBuilder
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.TimeUnit

/**
 * AppAuth's [DefaultConnectionBuilder] (https only, 15 s connect / 10 s read, no redirects) — except that debug
 * builds pointing at a local plain-http IdP may opt into cleartext. Release builds never get [allowCleartext].
 */
internal class OidcConnectionBuilder(private val allowCleartext: Boolean) : ConnectionBuilder {
    override fun openConnection(uri: Uri): HttpURLConnection {
        if (!allowCleartext) return DefaultConnectionBuilder.INSTANCE.openConnection(uri)
        return (URL(uri.toString()).openConnection() as HttpURLConnection).apply {
            connectTimeout = TimeUnit.SECONDS.toMillis(CONNECT_TIMEOUT_SECONDS).toInt()
            readTimeout = TimeUnit.SECONDS.toMillis(READ_TIMEOUT_SECONDS).toInt()
            instanceFollowRedirects = false
        }
    }

    private companion object {
        const val CONNECT_TIMEOUT_SECONDS = 15L
        const val READ_TIMEOUT_SECONDS = 10L
    }
}
