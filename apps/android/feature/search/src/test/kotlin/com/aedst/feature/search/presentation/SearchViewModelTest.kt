package com.aedst.feature.search.presentation

import androidx.lifecycle.SavedStateHandle
import com.aedst.core.common.Outcome
import com.aedst.core.testing.MainDispatcherExtension
import com.aedst.feature.search.domain.SearchRepository
import com.aedst.feature.search.domain.SearchResults
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.extension.RegisterExtension

class SearchViewModelTest {

    @JvmField
    @RegisterExtension
    val mainDispatcherRule = MainDispatcherExtension()

    private val queries = mutableListOf<String>()
    private val repository = object : SearchRepository {
        override suspend fun search(query: String, pageToken: String?): Outcome<SearchResults> {
            queries += query
            return Outcome.Success(SearchResults(emptyList(), nextPageToken = null, totalEstimate = 0))
        }
    }

    @Test
    fun `typing quickly sends only the settled query`() = runTest(mainDispatcherRule.testDispatcher) {
        val viewModel = SearchViewModel(repository, SavedStateHandle())
        val collector = backgroundScope.launch { viewModel.state.collect { } }

        "milk".forEachIndexed { index, _ -> viewModel.onIntent(SearchIntent.QueryChanged("milk".take(index + 1))) }
        testScheduler.advanceTimeBy(SearchViewModel.DEBOUNCE_MS + 1)
        testScheduler.runCurrent()

        assertEquals(listOf("milk"), queries)
        assertTrue(viewModel.state.value.result is SearchResultState.Results)
        collector.cancel()
    }

    @Test
    fun `queries shorter than the minimum never hit the network`() = runTest(mainDispatcherRule.testDispatcher) {
        val viewModel = SearchViewModel(repository, SavedStateHandle())
        val collector = backgroundScope.launch { viewModel.state.collect { } }

        viewModel.onIntent(SearchIntent.QueryChanged("m"))
        testScheduler.advanceTimeBy(SearchViewModel.DEBOUNCE_MS + 1)
        testScheduler.runCurrent()

        assertTrue(queries.isEmpty())
        assertEquals(SearchResultState.Idle, viewModel.state.value.result)
        collector.cancel()
    }

    @Test
    fun `the query survives process death and is searched again`() = runTest(mainDispatcherRule.testDispatcher) {
        val first = SavedStateHandle()
        val viewModel = SearchViewModel(repository, first)
        viewModel.onIntent(SearchIntent.QueryChanged("milk"))

        // What the system keeps across process death is the handle's map, handed to the new ViewModel.
        val restored = SearchViewModel(repository, SavedStateHandle(first.keys().associateWith { first.get<Any>(it) }))
        val collector = backgroundScope.launch { restored.state.collect { } }
        testScheduler.advanceTimeBy(SearchViewModel.DEBOUNCE_MS + 1)
        testScheduler.runCurrent()

        assertEquals("milk", restored.state.value.query)
        assertEquals(listOf("milk"), queries)
        collector.cancel()
    }
}
