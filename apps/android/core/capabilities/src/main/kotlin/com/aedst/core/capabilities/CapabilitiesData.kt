package com.aedst.core.capabilities

import androidx.datastore.core.DataStore
import com.aedst.capabilities.v1.CapabilitiesServiceClientInterface
import com.aedst.capabilities.v1.GetCapabilitiesResponse
import com.aedst.capabilities.v1.UpdateStatus
import com.aedst.capabilities.v1.getCapabilitiesRequest
import com.aedst.core.datastore.UserPrefs
import com.aedst.core.network.rpc
import com.google.protobuf.InvalidProtocolBufferException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import java.io.IOException
import javax.inject.Inject

/** Fetches the server's answer. Public RPC: no token is needed, and a failure is thrown as an `AedstError`. */
fun interface CapabilitiesRemote {
    suspend fun fetch(): GetCapabilitiesResponse
}

class ConnectCapabilitiesRemote @Inject constructor(private val client: CapabilitiesServiceClientInterface) :
    CapabilitiesRemote {
    override suspend fun fetch(): GetCapabilitiesResponse = rpc { client.getCapabilities(getCapabilitiesRequest {}) }
}

/** The last answer that was received, kept across restarts (`UserPrefs.capabilities_snapshot`). */
interface CapabilitiesCache {
    /** `null` until the first successful fetch, or when the stored bytes cannot be read. */
    val lastKnown: Flow<GetCapabilitiesResponse?>

    suspend fun save(response: GetCapabilitiesResponse)
}

class DataStoreCapabilitiesCache @Inject constructor(private val dataStore: DataStore<UserPrefs>) :
    CapabilitiesCache {
    override val lastKnown: Flow<GetCapabilitiesResponse?> = dataStore.data.map { prefs ->
        if (prefs.capabilitiesSnapshot.isEmpty) {
            null
        } else {
            try {
                GetCapabilitiesResponse.parseFrom(prefs.capabilitiesSnapshot)
            } catch (@Suppress("SwallowedException") e: InvalidProtocolBufferException) {
                null
            }
        }
    }

    /** Best-effort: a full disk only means the next start falls back to the defaults. */
    override suspend fun save(response: GetCapabilitiesResponse) {
        try {
            dataStore.updateData { it.toBuilder().setCapabilitiesSnapshot(response.toByteString()).build() }
        } catch (@Suppress("SwallowedException") e: IOException) {
            // not cached
        }
    }
}

/** Generated message -> the app's pure model. Unknown enum values and params are ignored, never fatal. */
fun GetCapabilitiesResponse.toServerCapabilities(): ServerCapabilities = ServerCapabilities(
    features = featuresMap.mapValues { (_, feature) ->
        ServerCapabilities.Feature(
            enabled = feature.enabled,
            requiredClientVersion = feature.requiredClientVersion.ifBlank { null },
        )
    },
    clients = clientsMap.mapValues { (_, window) ->
        ServerCapabilities.ClientWindow(minimum = window.minimum, recommended = window.recommended)
    },
    updateStatus = when (updateStatus) {
        UpdateStatus.UPDATE_STATUS_CURRENT -> ServerCapabilities.UpdateStatus.CURRENT
        UpdateStatus.UPDATE_STATUS_RECOMMENDED -> ServerCapabilities.UpdateStatus.RECOMMENDED
        else -> ServerCapabilities.UpdateStatus.UNSPECIFIED
    },
)
