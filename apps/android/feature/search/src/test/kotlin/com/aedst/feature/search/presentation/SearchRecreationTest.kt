package com.aedst.feature.search.presentation

import androidx.lifecycle.SavedStateHandle
import com.aedst.core.common.Outcome
import com.aedst.feature.search.domain.SearchRepository
import com.aedst.feature.search.domain.SearchResults
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * The search text across the system killing and restoring the process: the [SavedStateHandle] goes through a real
 * `Bundle` (Robolectric; JUnit 4 runner, see libs.versions.toml) into a new handle and a new ViewModel.
 */
@RunWith(RobolectricTestRunner::class)
class SearchRecreationTest {

    private val repository = object : SearchRepository {
        override suspend fun search(query: String, pageToken: String?): Outcome<SearchResults> =
            Outcome.Success(SearchResults(emptyList(), nextPageToken = null, totalEstimate = 0))
    }

    @Test
    fun `the query survives a save and restore through a Bundle`() {
        val before = SavedStateHandle()
        SearchViewModel(repository, before).onIntent(SearchIntent.QueryChanged("quarterly report"))

        val bundle = before.savedStateProvider().saveState()
        val after = SearchViewModel(repository, SavedStateHandle.createHandle(bundle, null))

        assertEquals("quarterly report", after.state.value.query)
    }
}
