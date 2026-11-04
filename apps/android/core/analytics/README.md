# core:analytics

Telemetry for the whole app, behind small interfaces so features never import a vendor SDK.

| Responsibility | Tool | Interface |
|---|---|---|
| Crash + error reporting, uncaught exceptions, ANRs | Sentry Android (`SentryTelemetry`) | `ErrorReporter` (core/common) |
| HTTP spans, network breadcrumbs, W3C `traceparent` to the API | `sentry-okhttp` (`SentryHttpTelemetry`) | `HttpTelemetry` (core/network) |
| Navigation breadcrumbs + screen events | Sentry breadcrumb + PostHog `screen` from the Navigation 3 back stack (`NavigationTelemetry`) | — |
| Product analytics | PostHog Android (`PostHogAnalytics`) | `AnalyticsTracker` |
| Feature flags | PostHog Android | `FeatureFlags` |
| Analytics consent (opt-in, like web's `aedst_consent`) | DataStore `UserPrefs.analytics_consent` | `AnalyticsConsentStore` |

Configuration (never committed; empty = SDK disabled, no traffic):

| Gradle property | Env var | Meaning |
|---|---|---|
| `aedst.sentryDsn` | `SENTRY_DSN` | Sentry DSN |
| `aedst.posthogKey` | `POSTHOG_KEY` | PostHog project token |
| `aedst.posthogHost` | `POSTHOG_HOST` | PostHog host (default `https://eu.i.posthog.com`) |
| `aedst.environment` | `AEDST_ENVIRONMENT` | Sentry environment (default `development`/`production` by build type) |

R8 mapping upload (app module, Sentry Gradle plugin) runs only when `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` and
`SENTRY_PROJECT` are set in the environment.
