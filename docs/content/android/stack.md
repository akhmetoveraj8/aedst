---
title: Stack
description: The complete Android stack with exact versions.
---

# Android stack

Kotlin / Jetpack Compose (`apps/android`). Versions are pinned in the repository (checked against the registries on **2026-10-07**). Approved-library rules and rejections: [Library-First](/library-first#android). How to bump versions: [Stack overview](/stack#keeping-it-current).

| Area | Tool | Version |
|---|---|---|
| Language | Kotlin | **2.5.0-RC** (owner exception to stable-only, 2026-11-21; latest stable is 2.4.21; not compiled) |
| Build | AGP / Gradle / KSP | **9.5.2** / **9.9.2** / 2.3.14 |
| JDK | Temurin | **21** |
| UI | Jetpack Compose (BOM) | **2026.09.00** |
| DI | Metro (`dev.zacsweers.metro`, `metrox-viewmodel`, `metrox-viewmodel-compose`) | **1.6.0** |
| Async | Coroutines + Flow | **1.11.0** |
| Navigation | Navigation 3 (runtime/ui) / lifecycle-viewmodel-navigation3 | 1.2.0 / 2.11.0 |
| Sign-in | AppAuth-Android (Code + PKCE, Custom Tab) | 0.11.1 |
| API client | connect-kotlin over OkHttp | **0.10.0** / **5.5.1** |
| Protobuf | protobuf-javalite / Gradle plugin | 4.36.2 / 0.10.0 |
| Serialization | kotlinx.serialization | 1.13.0 |
| Database | Room 3 (`androidx.room3`) | **3.0.3** |
| Preferences | DataStore + Protobuf | 1.3.0 |
| Secrets | Android Keystore + Tink | 1.24.0 |
| Background work | WorkManager | 2.12.0 |
| Images | Coil 3 | **3.6.3** |
| Video / player / compression | AndroidX Media3 (ExoPlayer, Compose UI, Transformer) | **1.11.1** |
| Push | Firebase Cloud Messaging (Firebase BoM) | BoM **35.2.0** |
| Errors / performance / tracing | Sentry Android + Gradle plugin | **8.65.1** / 6.27.0 |
| Analytics + feature flags | PostHog Android | **3.77.1** |
| Anti-abuse | Play Integrity | 1.6.0 |
| Leak detection | LeakCanary (debug builds of `app` and `app-tv` only) | **2.14** |
| Static analysis | detekt (`dev.detekt`, pre-release exception) / ktlint-gradle / Android Lint | 2.0.0-alpha.6 / 14.2.0 |
| Tests | JUnit 6 Jupiter (vintage engine only in Robolectric/Compose-rule modules) / Roborazzi / MockK / Turbine | 6.1.3 / 1.79.0 / 1.14.12 / 1.2.1 |
| Adaptive layouts | androidx.compose.material3.adaptive | 1.3.0 |
| Performance | Macrobenchmark + Baseline Profiles | 1.5.0 |
| Dependency updates | Renovate (repo-wide) | n/a |
