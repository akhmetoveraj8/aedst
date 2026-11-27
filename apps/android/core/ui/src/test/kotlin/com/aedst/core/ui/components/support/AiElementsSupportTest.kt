package com.aedst.core.ui.components.support

import com.aedst.core.ui.screens.PlayStoreLinks
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class AiElementsSupportTest {

    @Test
    fun `only absolute http and https links with a host are web urls`() {
        listOf("https://example.com/a", "http://example.com", "HTTPS://Example.com/x").forEach {
            assertTrue(isWebUrl(it), it)
        }
    }

    @Test
    fun `schemes that launch apps or read files are never web urls`() {
        listOf(
            "intent://scan/#Intent;scheme=zxing;end",
            "javascript:alert(1)",
            "file:///sdcard/a",
            "content://com.app/x",
            "tel:+123",
            "market://details?id=a.b",
            "https:///no-host",
            "//example.com",
            "example.com",
            "",
            "ht tp://bad",
        ).forEach { assertFalse(isWebUrl(it), it) }
    }

    @Test
    fun `the host name drops www and falls back to the raw text`() {
        assertEquals("example.com", citationHostname("https://www.example.com/a?b=1"))
        assertEquals("not a url", citationHostname("not a url"))
    }
}

class PlayStoreTrustTest {

    @Test
    fun `the two generated store links are trusted`() {
        assertTrue(PlayStoreLinks.isTrustedStoreUri(PlayStoreLinks.marketUri("com.aedst.android")))
        assertTrue(PlayStoreLinks.isTrustedStoreUri(PlayStoreLinks.webUri("com.aedst.android")))
    }

    @Test
    fun `other hosts, schemes, extra query parts and odd package names are refused`() {
        listOf(
            "https://evil.example/store/apps/details?id=com.aedst.android",
            "http://play.google.com/store/apps/details?id=com.aedst.android",
            "https://play.google.com/store/apps/details?id=com.aedst.android&x=1",
            "https://play.google.com/store/apps/details?id=com.aedst.android#frag",
            "https://user@play.google.com/store/apps/details?id=com.aedst.android",
            "https://play.google.com/other?id=com.aedst.android",
            "market://search?id=com.aedst.android",
            "market://details?id=nodots",
            "market://details?id=a.b;intent",
            "intent://details?id=com.aedst.android",
            "javascript:alert(1)",
            "",
        ).forEach { assertFalse(PlayStoreLinks.isTrustedStoreUri(it), it) }
    }

    @Test
    fun `package names follow the application id grammar`() {
        assertTrue(PlayStoreLinks.isValidPackageName("com.aedst.android"))
        assertTrue(PlayStoreLinks.isValidPackageName("com.aedst_2.app"))
        assertFalse(PlayStoreLinks.isValidPackageName("com"))
        assertFalse(PlayStoreLinks.isValidPackageName("1com.app"))
        assertFalse(PlayStoreLinks.isValidPackageName("com.app/../x"))
    }
}
