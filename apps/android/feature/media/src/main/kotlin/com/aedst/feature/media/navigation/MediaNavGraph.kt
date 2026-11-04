package com.aedst.feature.media.navigation

import androidx.navigation3.runtime.EntryProviderScope
import androidx.navigation3.runtime.NavKey
import com.aedst.core.navigation.AedstNavGraph
import com.aedst.core.navigation.AedstNavigator
import com.aedst.core.navigation.MediaDetailKey
import com.aedst.core.navigation.MediaLibraryKey
import com.aedst.feature.media.presentation.detail.MediaDetailRoute
import com.aedst.feature.media.presentation.library.MediaLibraryRoute

/** feature/media's public boundary: the caller's media library and the image/video viewer ([MediaDetailKey]). */
class MediaNavGraph : AedstNavGraph {
    override fun register(scope: EntryProviderScope<NavKey>, navigator: AedstNavigator) {
        scope.entry<MediaLibraryKey> {
            MediaLibraryRoute(onOpenMedia = { id -> navigator.navigate(MediaDetailKey(id)) })
        }
        scope.entry<MediaDetailKey> { key ->
            MediaDetailRoute(mediaId = key.mediaId, onBack = navigator::back)
        }
    }
}
