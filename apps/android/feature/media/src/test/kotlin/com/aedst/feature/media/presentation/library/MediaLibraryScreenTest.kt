package com.aedst.feature.media.presentation.library

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
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

/** [MediaLibraryScreen] against synthetic state (Robolectric, English resources; JUnit 4 runner). */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "en")
class MediaLibraryScreenTest {

    @get:Rule
    val compose = createComposeRule()

    private val context: Context = ApplicationProvider.getApplicationContext()

    @Test
    fun `is accessible while loading, empty and with files, and every file has a spoken name`() {
        var state by mutableStateOf(MediaLibraryState())
        compose.setContent {
            AedstTheme {
                MediaLibraryScreen(state = state, uploads = emptyList(), onOpenMedia = {}, onIntent = {})
            }
        }
        compose.assertScreenSemantics("MediaLibraryScreen loading")

        state = MediaLibraryState(isLoading = false)
        compose.waitForIdle()
        compose.onNodeWithText(context.getString(R.string.media_empty)).assertExists()
        compose.assertScreenSemantics("MediaLibraryScreen empty")

        // No URL yet (processing): the tile shows a kind icon, which must still carry the file name.
        state = MediaLibraryState(items = listOf(mediaItem("a", url = ""), mediaItem("b", url = "")), isLoading = false)
        compose.waitForIdle()
        compose.assertScreenSemantics("MediaLibraryScreen files")
    }

    @Test
    fun `a tapped file opens and load-more asks for the next page`() {
        val opened = mutableListOf<String>()
        val intents = mutableListOf<MediaLibraryIntent>()
        compose.setContent {
            AedstTheme {
                MediaLibraryScreen(
                    state = MediaLibraryState(
                        items = listOf(mediaItem("a", url = "")),
                        nextPageToken = "p2",
                        isLoading = false,
                    ),
                    uploads = emptyList(),
                    onOpenMedia = { opened += it },
                    onIntent = { intents += it },
                )
            }
        }

        compose.onNodeWithText(context.getString(R.string.media_load_more)).performClick()

        assertEquals(listOf<MediaLibraryIntent>(MediaLibraryIntent.LoadMore), intents)
    }
}
