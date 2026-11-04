package com.aedst.feature.auth.presentation.login

import android.content.Context
import androidx.compose.ui.test.getBoundsInRoot
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.test.core.app.ApplicationProvider
import com.aedst.core.ui.theme.AedstTheme
import com.aedst.feature.auth.R
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The sign-in form must fill a phone but stay a readable column on tablets and foldables. The primary button fills the
 * form width, so its width is the form width (Robolectric; JUnit 4 runner, see libs.versions.toml).
 */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "en")
class LoginScreenWindowSizesTest {

    @get:Rule
    val compose = createComposeRule()

    private val context: Context = ApplicationProvider.getApplicationContext()

    private fun formWidthDp(): Float {
        compose.setContent { AedstTheme { LoginScreen(state = LoginState(), onIntent = {}) } }
        val bounds = compose.onNodeWithText(context.getString(R.string.auth_login_submit)).getBoundsInRoot()
        return (bounds.right - bounds.left).value
    }

    @Test
    @Config(qualifiers = "en-w360dp-h800dp")
    fun `compact uses the whole width minus the padding`() {
        assertTrue(formWidthDp() >= 360 - 2 * PADDING_DP - TOLERANCE_DP)
    }

    @Test
    @Config(qualifiers = "en-w700dp-h900dp")
    fun `medium is capped at the form width`() {
        assertTrue(formWidthDp() <= FORM_WIDTH_DP - 2 * PADDING_DP + TOLERANCE_DP)
    }

    @Test
    @Config(qualifiers = "en-w1000dp-h700dp")
    fun `expanded is capped at the form width`() {
        assertTrue(formWidthDp() <= FORM_WIDTH_DP - 2 * PADDING_DP + TOLERANCE_DP)
    }

    private companion object {
        /** AedstContentWidth.form. */
        const val FORM_WIDTH_DP = 480f

        /** The form's own padding on each side (LoginScreen). */
        const val PADDING_DP = 24f
        const val TOLERANCE_DP = 1f
    }
}
