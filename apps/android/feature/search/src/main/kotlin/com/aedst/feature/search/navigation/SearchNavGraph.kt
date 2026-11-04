package com.aedst.feature.search.navigation

import androidx.navigation3.runtime.EntryProviderScope
import androidx.navigation3.runtime.NavKey
import com.aedst.core.navigation.AedstNavGraph
import com.aedst.core.navigation.AedstNavigator
import com.aedst.core.navigation.AedstRoutes
import com.aedst.core.navigation.SearchKey
import com.aedst.feature.search.presentation.SearchRoute

/** feature/search's public boundary. A hit's server link (`/tasks/<id>`) is resolved to a key by `AedstRoutes`. */
class SearchNavGraph : AedstNavGraph {
    override fun register(scope: EntryProviderScope<NavKey>, navigator: AedstNavigator) {
        scope.entry<SearchKey> {
            SearchRoute(onOpenLink = { link -> AedstRoutes.keyForLink(link)?.let(navigator::navigate) })
        }
    }
}
