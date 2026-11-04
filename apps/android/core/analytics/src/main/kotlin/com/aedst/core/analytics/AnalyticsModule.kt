package com.aedst.core.analytics

import com.aedst.core.common.AppInitializer
import com.aedst.core.common.ErrorReporter
import com.aedst.core.network.HttpTelemetry
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import dagger.multibindings.IntoSet

@Module
@InstallIn(SingletonComponent::class)
abstract class AnalyticsModule {

    @Binds
    abstract fun bindAnalyticsTracker(impl: PostHogAnalytics): AnalyticsTracker

    @Binds
    abstract fun bindFeatureFlags(impl: PostHogAnalytics): FeatureFlags

    @Binds
    abstract fun bindConsentStore(impl: DataStoreAnalyticsConsentStore): AnalyticsConsentStore

    @Binds
    abstract fun bindErrorReporter(impl: SentryErrorReporter): ErrorReporter

    @Binds
    abstract fun bindHttpTelemetry(impl: SentryHttpTelemetry): HttpTelemetry

    @Binds
    @IntoSet
    abstract fun bindTelemetryInitializer(impl: TelemetryInitializer): AppInitializer
}
