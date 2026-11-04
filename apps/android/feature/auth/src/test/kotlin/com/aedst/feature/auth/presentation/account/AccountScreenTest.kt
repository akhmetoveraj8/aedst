package com.aedst.feature.auth.presentation.account

import android.content.Context
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ApplicationProvider
import com.aedst.core.testing.assertScreenSemantics
import com.aedst.core.ui.theme.AedstTheme
import com.aedst.feature.auth.R
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** The account screen against synthetic state (Robolectric, English resources; JUnit 4 runner). */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "en")
class AccountScreenTest {

    @get:Rule
    val compose = createComposeRule()

    private val context: Context = ApplicationProvider.getApplicationContext()
    private val intents = mutableListOf<AccountIntent>()

    private fun show(state: AccountState) {
        compose.setContent { AedstTheme { AccountScreen(state = state, onIntent = { intents += it }) } }
    }

    @Test
    fun `controls are accessible`() {
        show(AccountState(userId = "user-1234", isAnalyticsEnabled = true))

        compose.assertScreenSemantics("AccountScreen")
    }

    @Test
    fun `shows who is signed in`() {
        show(AccountState(userId = "user-1234"))

        compose.onNodeWithText(context.getString(R.string.auth_signed_in_as, "user-1234")).assertExists()
    }

    @Test
    fun `sign out and the consent switch send intents`() {
        show(AccountState(userId = "user-1234"))

        compose.onNodeWithText(context.getString(R.string.auth_analytics_consent)).performClick()
        compose.onNodeWithText(context.getString(R.string.auth_sign_out)).performClick()

        assertEquals(listOf(AccountIntent.SetAnalyticsEnabled(true), AccountIntent.SignOut), intents)
    }

    @Test
    fun `while signing out the button is busy and cannot be tapped again`() {
        show(AccountState(userId = "user-1234", isSigningOut = true))

        // While loading, AedstButton swaps the label for a spinner and keeps the name as a description, disabled.
        compose.onNodeWithContentDescription(context.getString(R.string.auth_sign_out)).assertIsNotEnabled()
    }
}
