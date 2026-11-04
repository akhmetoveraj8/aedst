package com.aedst.core.ui.screens

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class PlayStoreLinksTest {

    @Test
    fun `market uri targets the Play Store app listing of the package`() {
        assertEquals("market://details?id=com.aedst.android", PlayStoreLinks.marketUri("com.aedst.android"))
    }

    @Test
    fun `web uri is the https Play listing used when the Play Store app is missing`() {
        assertEquals(
            "https://play.google.com/store/apps/details?id=com.aedst.android",
            PlayStoreLinks.webUri("com.aedst.android"),
        )
    }
}
