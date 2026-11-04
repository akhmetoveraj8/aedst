package com.aedst.core.analytics

import androidx.datastore.core.DataStore
import com.aedst.core.datastore.AnalyticsConsent
import com.aedst.core.datastore.UserPrefs
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

/** Persists the analytics opt-in in the device's `UserPrefs` DataStore (not a secret, survives sign-out). */
@Singleton
class DataStoreAnalyticsConsentStore @Inject constructor(private val dataStore: DataStore<UserPrefs>) :
    AnalyticsConsentStore {

    override val consent: Flow<AnalyticsConsentState> = dataStore.data
        .map { prefs ->
            when (prefs.analyticsConsent) {
                AnalyticsConsent.ANALYTICS_CONSENT_GRANTED -> AnalyticsConsentState.GRANTED
                AnalyticsConsent.ANALYTICS_CONSENT_DENIED -> AnalyticsConsentState.DENIED
                // No recorded or an unreadable value: the privacy-preserving default is "not asked yet", never granted.
                AnalyticsConsent.ANALYTICS_CONSENT_UNSET, AnalyticsConsent.UNRECOGNIZED -> AnalyticsConsentState.UNSET
            }
        }
        .distinctUntilChanged()

    override suspend fun setConsent(granted: Boolean) {
        val value = if (granted) {
            AnalyticsConsent.ANALYTICS_CONSENT_GRANTED
        } else {
            AnalyticsConsent.ANALYTICS_CONSENT_DENIED
        }
        dataStore.updateData { prefs ->
            prefs.toBuilder()
                .setAnalyticsConsent(value)
                .build()
        }
    }
}
