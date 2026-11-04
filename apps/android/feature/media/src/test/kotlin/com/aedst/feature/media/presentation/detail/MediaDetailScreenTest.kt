package com.aedst.feature.media.presentation.detail

import android.content.Context
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ApplicationProvider
import com.aedst.core.testing.assertScreenSemantics
import com.aedst.core.ui.theme.AedstTheme
import com.aedst.feature.media.R
import com.aedst.feature.media.mediaItem
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * [MediaDetailScreen] against synthetic state (Robolectric, English resources; JUnit 4 runner). The item has no URL, so
 * the media area is the "processing" placeholder and no player is created; the layouts per width class are covered by
 * `MediaDetailBodyTest`.
 */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "en")
class MediaDetailScreenTest {

    @get:Rule
    val compose = createComposeRule()

    private val context: Context = ApplicationProvider.getApplicationContext()
    private val intents = mutableListOf<MediaDetailIntent>()

    private fun show(state: MediaDetailState) {
        compose.setContent {
            AedstTheme { MediaDetailScreen(state = state, onIntent = { intents += it }, onBack = {}) }
        }
    }

    @Test
    fun `is accessible with a loaded item`() {
        show(MediaDetailState(item = mediaItem("m1", url = ""), isLoading = false))

        compose.assertScreenSemantics("MediaDetailScreen loaded")
    }

    @Test
    fun `is accessible while loading`() {
        show(MediaDetailState())

        compose.assertScreenSemantics("MediaDetailScreen loading")
    }

    @Test
    fun `the delete button sends the delete intent`() {
        show(MediaDetailState(item = mediaItem("m1", url = ""), isLoading = false))

        compose.onNodeWithContentDescription(context.getString(R.string.media_delete)).performClick()

        assertEquals(listOf<MediaDetailIntent>(MediaDetailIntent.Delete), intents)
    }
}
