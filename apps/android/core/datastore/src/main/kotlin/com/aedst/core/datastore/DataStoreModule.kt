package com.aedst.core.datastore

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.core.DataStoreFactory
import androidx.datastore.core.handlers.ReplaceFileCorruptionHandler
import androidx.datastore.dataStoreFile
import com.aedst.core.common.ApplicationContext
import dev.zacsweers.metro.AppScope
import dev.zacsweers.metro.BindingContainer
import dev.zacsweers.metro.ContributesTo
import dev.zacsweers.metro.Provides
import dev.zacsweers.metro.SingleIn
import java.io.File

/**
 * The preferences store as production builds it. A corrupt file is replaced by the defaults instead of failing every
 * read: what is lost is the analytics consent answer (asked again), onboarding state and push bookkeeping (registered
 * again on the next start), all re-derivable; nothing secret lives here.
 */
fun createUserPrefsDataStore(produceFile: () -> File): DataStore<UserPrefs> = DataStoreFactory.create(
    serializer = UserPreferencesSerializer,
    corruptionHandler = userPrefsCorruptionHandler,
    produceFile = produceFile,
)

/** What DataStore does with a file the serializer reported as corrupt: start over from the defaults. */
internal val userPrefsCorruptionHandler: ReplaceFileCorruptionHandler<UserPrefs> =
    ReplaceFileCorruptionHandler { UserPrefs.getDefaultInstance() }

@BindingContainer
@ContributesTo(AppScope::class)
object DataStoreModule {

    @Provides
    @SingleIn(AppScope::class)
    fun provideUserPrefsDataStore(@ApplicationContext context: Context): DataStore<UserPrefs> =
        createUserPrefsDataStore { context.dataStoreFile("user_prefs.pb") }
}
