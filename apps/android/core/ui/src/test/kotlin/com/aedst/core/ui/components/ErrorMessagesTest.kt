package com.aedst.core.ui.components

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.aedst.core.common.AedstError
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "en")
class ErrorMessagesTest {

    private val context: Context get() = ApplicationProvider.getApplicationContext()

    private val allErrors: List<AedstError> = listOf(
        AedstError.Unavailable("n"),
        AedstError.Offline(),
        AedstError.Unauthenticated(),
        AedstError.NotFound(),
        AedstError.InvalidInput("v"),
        AedstError.Unknown("u"),
        AedstError.Forbidden(),
        AedstError.Conflict(),
        AedstError.RateLimited(),
        AedstError.UpgradeRequired(),
    )

    @Test
    fun `every error kind maps to its own string`() {
        val ids = allErrors.map { it.userMessageRes() }

        assertEquals(ids.size, ids.toSet().size)
    }

    @Test
    fun `the user message never contains the diagnostic message`() {
        val error = AedstError.InvalidInput("internal detail: column users.email_hash")

        assertTrue(!context.getString(error.userMessageRes()).contains("internal detail"))
    }

    @Test
    fun `every error string is translated in every supported locale`() {
        val english = allErrors.associateWith { context.getString(it.userMessageRes()) }

        listOf("ru", "uz", "tg", "ar").forEach { locale ->
            RuntimeEnvironment.setQualifiers("+$locale")
            allErrors.forEach { error ->
                val text = context.getString(error.userMessageRes())
                assertTrue("$locale/${error::class.simpleName} is blank", text.isNotBlank())
                assertNotEquals("$locale/${error::class.simpleName} not translated", english[error], text)
            }
        }
    }
}
