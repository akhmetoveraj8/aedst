package com.aedst.core.datastore

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.core.DataStoreFactory
import androidx.datastore.core.handlers.ReplaceFileCorruptionHandler
import androidx.datastore.dataStoreFile
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import java.io.File
import javax.inject.Singleton

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

@Module
@InstallIn(SingletonComponent::class)
object DataStoreModule {

    @Provides
    @Singleton
    fun provideUserPrefsDataStore(@ApplicationContext context: Context): DataStore<UserPrefs> =
        createUserPrefsDataStore { context.dataStoreFile("user_prefs.pb") }
}
