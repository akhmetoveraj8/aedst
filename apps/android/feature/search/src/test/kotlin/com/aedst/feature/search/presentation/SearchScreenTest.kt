package com.aedst.feature.search.presentation

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.test.core.app.ApplicationProvider
import com.aedst.core.common.AedstError
import com.aedst.core.testing.assertScreenSemantics
import com.aedst.core.ui.theme.AedstTheme
import com.aedst.feature.search.R
import com.aedst.feature.search.domain.SearchHit
import com.aedst.feature.search.domain.SearchKind
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** [SearchScreen] against synthetic state (Robolectric, English resources; JUnit 4 runner). */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "en")
class SearchScreenTest {

    @get:Rule
    val compose = createComposeRule()

    private val context: Context = ApplicationProvider.getApplicationContext()
    private val hit = SearchHit(
        kind = SearchKind.TASK,
        id = "t1",
        title = "Quarterly report",
        snippet = "Write the report before Friday",
        link = "/tasks/t1",
        updatedAt = null,
    )

    @Test
    fun `is accessible when idle, with results, without results and after a failure`() {
        var state by mutableStateOf(SearchState())
        compose.setContent {
            AedstTheme { SearchScreen(state = state, onIntent = {}, onOpenLink = {}) }
        }
        compose.onNodeWithText(context.getString(R.string.search_hint)).assertExists()
        compose.assertScreenSemantics("SearchScreen idle")

        state = SearchState("report", SearchResultState.Results(listOf(hit), totalEstimate = 1))
        compose.waitForIdle()
        compose.onNodeWithText("Quarterly report").assertExists()
        compose.assertScreenSemantics("SearchScreen results")

        state = SearchState("zzz", SearchResultState.Results(emptyList(), totalEstimate = 0))
        compose.waitForIdle()
        compose.onNodeWithText(context.getString(R.string.search_no_results)).assertExists()

        state = SearchState("report", SearchResultState.Failed(AedstError.Offline()))
        compose.waitForIdle()
        compose.assertScreenSemantics("SearchScreen failed")
    }

    @Test
    fun `typing sends the text and a tapped hit opens its link`() {
        val intents = mutableListOf<SearchIntent>()
        val opened = mutableListOf<String>()
        compose.setContent {
            AedstTheme {
                SearchScreen(
                    state = SearchState("", SearchResultState.Results(listOf(hit), totalEstimate = 1)),
                    onIntent = { intents += it },
                    onOpenLink = { opened += it },
                )
            }
        }

        compose.onNode(hasSetTextAction()).performTextInput("o")
        compose.onNodeWithText("Quarterly report").performClick()

        assertEquals(listOf<SearchIntent>(SearchIntent.QueryChanged("o")), intents)
        assertEquals(listOf("/tasks/t1"), opened)
    }
}
