package com.aedst.core.datastore

import androidx.datastore.core.CorruptionException
import androidx.datastore.core.Serializer
import com.google.protobuf.InvalidProtocolBufferException
import java.io.InputStream
import java.io.OutputStream

/**
 * NOTE: [UserPrefs] is generated from `src/main/proto/user_prefs.proto` by
 * the `com.google.protobuf` Gradle plugin at build time — it does not exist
 * in source control. Running a sync (or `./gradlew :core:datastore:generateProto`)
 * before opening this file in the IDE is expected to be needed once.
 *
 * A file that is not a valid [UserPrefs] document (a truncated write after a crash, a full disk, a bit flip) is
 * reported as [CorruptionException], the only failure DataStore hands to its `corruptionHandler`
 * (see [createUserPrefsDataStore]); any other exception would be thrown at every reader and keep the app broken
 * until the user cleared its data.
 */
object UserPreferencesSerializer : Serializer<UserPrefs> {
    override val defaultValue: UserPrefs = UserPrefs.getDefaultInstance()

    override suspend fun readFrom(input: InputStream): UserPrefs = try {
        UserPrefs.parseFrom(input)
    } catch (invalid: InvalidProtocolBufferException) {
        throw CorruptionException("Cannot read user_prefs.pb", invalid)
    }

    override suspend fun writeTo(t: UserPrefs, output: OutputStream) {
        t.writeTo(output)
    }
}
