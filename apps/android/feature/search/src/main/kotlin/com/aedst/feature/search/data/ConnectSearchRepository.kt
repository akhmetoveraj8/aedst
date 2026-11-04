package com.aedst.feature.search.data

import com.aedst.core.common.Outcome
import com.aedst.core.common.runCatchingOutcome
import com.aedst.core.network.rpc
import com.aedst.core.network.toInstantOrNull
import com.aedst.feature.search.domain.SearchHit
import com.aedst.feature.search.domain.SearchKind
import com.aedst.feature.search.domain.SearchRepository
import com.aedst.feature.search.domain.SearchResults
import com.aedst.search.v1.DocumentKind
import com.aedst.search.v1.SearchServiceClient
import com.aedst.search.v1.SearchServiceClientInterface
import com.aedst.search.v1.searchRequest
import com.connectrpc.ProtocolClientInterface
import dagger.Binds
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Inject
import javax.inject.Singleton

internal class ConnectSearchRepository @Inject constructor(private val client: SearchServiceClientInterface) :
    SearchRepository {

    override suspend fun search(query: String, pageToken: String?): Outcome<SearchResults> = runCatchingOutcome {
        val response = rpc {
            client.search(
                searchRequest {
                    this.query = query.take(MAX_QUERY_LENGTH)
                    pageSize = PAGE_SIZE
                    pageToken?.let { this.pageToken = it }
                },
            )
        }
        SearchResults(
            hits = response.hitsList.map { hit ->
                SearchHit(
                    kind = when (hit.kind) {
                        DocumentKind.DOCUMENT_KIND_TASK -> SearchKind.TASK
                        DocumentKind.DOCUMENT_KIND_MEDIA -> SearchKind.MEDIA
                        DocumentKind.DOCUMENT_KIND_UNSPECIFIED, DocumentKind.UNRECOGNIZED -> SearchKind.OTHER
                    },
                    id = hit.id,
                    title = hit.title,
                    snippet = hit.snippet,
                    link = hit.link,
                    updatedAt = if (hit.hasUpdatedAt()) hit.updatedAt.toInstantOrNull() else null,
                )
            },
            nextPageToken = response.nextPageToken.takeIf(String::isNotEmpty),
            totalEstimate = response.totalEstimate,
        )
    }

    private companion object {
        const val PAGE_SIZE = 20

        /** SearchRequest.query is validated to 1..200 characters. */
        const val MAX_QUERY_LENGTH = 200
    }
}

@Module
@InstallIn(SingletonComponent::class)
internal abstract class SearchModule {
    @Binds
    abstract fun bindSearchRepository(impl: ConnectSearchRepository): SearchRepository

    companion object {
        @Provides
        @Singleton
        fun provideSearchServiceClient(client: ProtocolClientInterface): SearchServiceClientInterface =
            SearchServiceClient(client)
    }
}
