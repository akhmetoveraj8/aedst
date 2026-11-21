package com.aedst.feature.search.domain

import com.aedst.core.common.Outcome
import kotlin.time.Instant

public enum class SearchKind { TASK, MEDIA, OTHER }

public data class SearchHit(
    val kind: SearchKind,
    val id: String,
    val title: String,
    /** Plain text with matches wrapped in U+E000 … U+E001 (see `highlightSnippet`). */
    val snippet: String,
    /** In-app link such as `/tasks/<id>`; resolved with `AedstRoutes.routeForLink`. */
    val link: String,
    val updatedAt: Instant?,
)

public data class SearchResults(val hits: List<SearchHit>, val nextPageToken: String?, val totalEstimate: Int)

/** Read-only, caller-scoped full-text search (SearchService). */
public interface SearchRepository {
    public suspend fun search(query: String, pageToken: String? = null): Outcome<SearchResults>
}
