package com.aedst.core.navigation

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.w3c.dom.Element
import org.w3c.dom.Node
import java.io.File
import javax.xml.parsers.DocumentBuilderFactory

/**
 * Static half of the App Links check (the OS half needs a device: `adb shell pm get-app-links`, see
 * docs/content/android/device-verification.md). It reads the real `app` manifest and `assetlinks.json.example` and
 * proves what the JVM can: the verified intent filter exists, is https-only, uses the host placeholder, covers exactly
 * the paths [AedstRoutes] resolves, and the assetlinks template names this application id.
 *
 * It lives in `core/navigation` because that module owns [AedstRoutes] and already runs JUnit 5; the `app` module has no
 * JVM test setup. The files are read relative to this module's directory (Gradle's working directory for tests).
 */
class AppLinkManifestTest {

    private val appDir = File("../../app")
    private val manifest = File(appDir, "src/main/AndroidManifest.xml")

    private fun androidAttr(element: Element, name: String): String? =
        element.getAttributeNS(ANDROID_NS, name).takeIf { it.isNotEmpty() }

    private fun children(element: Element, tag: String): List<Element> = (0 until element.childNodes.length)
        .map { element.childNodes.item(it) }
        .filter { it.nodeType == Node.ELEMENT_NODE && it.nodeName == tag }
        .map { it as Element }

    private fun verifiedFilters(): List<Element> {
        assertTrue(manifest.isFile, "app manifest not found at ${manifest.absolutePath}")
        val factory = DocumentBuilderFactory.newInstance().apply { isNamespaceAware = true }
        val document = factory.newDocumentBuilder().parse(manifest)
        val filters = document.getElementsByTagName("intent-filter")
        return (0 until filters.length)
            .map { filters.item(it) as Element }
            .filter { androidAttr(it, "autoVerify") == "true" }
    }

    @Test
    fun `exactly one auto-verified https view filter with the host placeholder`() {
        val filter = verifiedFilters().single()

        val actions = children(filter, "action").mapNotNull { androidAttr(it, "name") }
        val categories = children(filter, "category").mapNotNull { androidAttr(it, "name") }
        assertEquals(listOf("android.intent.action.VIEW"), actions)
        assertTrue("android.intent.category.DEFAULT" in categories)
        assertTrue("android.intent.category.BROWSABLE" in categories)

        val data = children(filter, "data")
        assertEquals(listOf("https"), data.mapNotNull { androidAttr(it, "scheme") })
        assertEquals(listOf("\${appLinkHost}"), data.mapNotNull { androidAttr(it, "host") })
    }

    @Test
    fun `path prefixes are exactly the links AedstRoutes opens`() {
        val prefixes = children(verifiedFilters().single(), "data").mapNotNull { androidAttr(it, "pathPrefix") }
        assertTrue(prefixes.isNotEmpty())
        assertEquals(prefixes.size, prefixes.toSet().size, "duplicate pathPrefix")
        prefixes.forEach { prefix ->
            assertTrue(prefix.startsWith("/") && prefix.count { it == '/' } == 1, "unexpected prefix $prefix")
            // The list screen of every prefix must resolve, otherwise the filter claims a link the app cannot open.
            assertNotNull(AedstRoutes.keyForLink(prefix), "pathPrefix $prefix has no screen in AedstRoutes")
        }
        // And the other way round: every feature the app can route to is claimed by the filter.
        listOf("tasks", "media", "notifications", "search", "admin").forEach { feature ->
            assertTrue("/$feature" in prefixes, "AedstRoutes handles /$feature but the manifest does not claim it")
        }
    }

    @Test
    fun `no other filter claims https view links`() {
        val factory = DocumentBuilderFactory.newInstance().apply { isNamespaceAware = true }
        val document = factory.newDocumentBuilder().parse(manifest)
        val filters = document.getElementsByTagName("intent-filter")
        val httpsViewFilters = (0 until filters.length).map { filters.item(it) as Element }.filter { filter ->
            children(filter, "data").any { androidAttr(it, "scheme") == "https" || androidAttr(it, "scheme") == "http" }
        }
        assertEquals(1, httpsViewFilters.size, "an unverified web-link filter would show a chooser and be hijackable")
    }

    @Test
    fun `assetlinks template names the application id and the all-urls relation`() {
        val template = File(appDir, "assetlinks.json.example")
        assertTrue(template.isFile, "assetlinks.json.example missing at ${template.absolutePath}")
        val text = template.readText()
        assertTrue("\"delegate_permission/common.handle_all_urls\"" in text)
        assertTrue("\"namespace\": \"android_app\"" in text)
        assertTrue("\"package_name\": \"$APPLICATION_ID\"" in text, "package_name must equal applicationId")
        assertTrue("sha256_cert_fingerprints" in text)
        // The template must stay a template: a real fingerprint is a per-environment value, never committed here.
        assertFalse(Regex("([0-9A-F]{2}:){31}[0-9A-F]{2}").containsMatchIn(text), "real fingerprint committed")
    }

    @Test
    fun `application id in the build script matches the template`() {
        val gradle = File(appDir, "build.gradle.kts").readText()
        assertTrue("applicationId = \"$APPLICATION_ID\"" in gradle)
    }

    private companion object {
        const val ANDROID_NS = "http://schemas.android.com/apk/res/android"
        const val APPLICATION_ID = "com.aedst.android"
    }
}
