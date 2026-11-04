---
description: "apps/android — Kotlin and Jetpack Compose, a Gradle module graph (feature/ → core/) with a phone app and a thin TV app. Status: JVM-verified, never run on a device (see..."
title: Android
---

# Android

`apps/android` — Kotlin and Jetpack Compose, a Gradle module graph (`feature/*` → `core/*`) with a phone app and a thin TV app. Status: **verified on the JVM** (unit tests, assemble, lint, ktlint, detekt), **never run on a device or emulator** (see [Platform status](/status)).

| Page | What it covers |
|---|---|
| [Architecture](/android/architecture) | Module map, boundary enforcement, offline outbox, phone and TV targets |
| [Stack](/android/stack) | Every tool and pinned version |
| [i18n](/android/i18n) | Per-module `strings.xml` resources |

Related: [UI kit](/ui-kit), [Library-First: Android](/library-first#android), [ADR-0013](/decisions/0013-android-offline-and-client-security).
