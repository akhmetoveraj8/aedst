package com.aedst.feature.media.presentation.detail

import android.content.Context
import androidx.compose.ui.test.getBoundsInRoot
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.test.core.app.ApplicationProvider
import com.aedst.core.ui.adaptive.AedstWidthClass
import com.aedst.core.ui.theme.AedstTheme
import com.aedst.feature.media.R
import com.aedst.feature.media.mediaItem
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * [MediaDetailBody] per width class (Robolectric; JUnit 4 runner, see libs.versions.toml). The item has no URL yet, so
 * the media area shows the "processing" placeholder and no player is created.
 */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "en")
class MediaDetailBodyTest {

    @get:Rule
    val compose = createComposeRule()

    private val context: Context = ApplicationProvider.getApplicationContext()
    private val item = mediaItem("m1", url = "")

    private fun show(widthClass: AedstWidthClass) {
        compose.setContent { AedstTheme { MediaDetailBody(item, widthClass) } }
    }

    private val placeholder get() = compose.onNodeWithText(context.getString(R.string.media_processing))
    private val status get() = compose.onNodeWithText(context.getString(R.string.media_status_ready))

    @Test
    @Config(qualifiers = "en-w360dp-h800dp")
    fun `compact stacks the status under the media`() {
        show(AedstWidthClass.COMPACT)

        assertTrue(status.getBoundsInRoot().top >= placeholder.getBoundsInRoot().bottom)
    }

    @Test
    @Config(qualifiers = "en-w700dp-h900dp")
    fun `medium also stacks`() {
        show(AedstWidthClass.MEDIUM)

        assertTrue(status.getBoundsInRoot().top >= placeholder.getBoundsInRoot().bottom)
    }

    @Test
    @Config(qualifiers = "en-w1000dp-h700dp")
    fun `expanded puts the status beside the media`() {
        show(AedstWidthClass.EXPANDED)

        assertTrue(status.getBoundsInRoot().left >= placeholder.getBoundsInRoot().right)
    }
}
