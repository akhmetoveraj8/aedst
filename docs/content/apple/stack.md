---
title: Stack
description: The complete Apple stack with exact versions.
---

# Apple stack

Swift / SwiftUI for iOS, iPadOS and macOS (`apps/apple`). Versions are pinned in the repository (checked against the registries on **2026-10-07**). Approved-library rules and rejections: [Library-First](/library-first#apple). How to bump versions: [Stack overview](/stack#keeping-it-current).

Minimum OS: **iOS / iPadOS 18.0**, **macOS 15.0** (single source: `Project.swift`). Nothing under `apps/apple` has been compiled; versions below are declared, not build-verified.

| Area | Tool | Version |
|---|---|---|
| Language / UI | Swift 6 + SwiftUI | Xcode **26.6** |
| Project generation | Tuist | **4.215.0** |
| API client | connect-swift + swift-protobuf | **1.2.3** / **1.39.0** |
| Persistence | GRDB | **7.12.0** |
| Observation | Observation (`@Observable`, `@Bindable`) | platform |
| Navigation | `NavigationStack` + `NavigationPath` | platform |
| Images | Nuke / NukeUI (only via `Core/AedstMedia`) | **13.2.1** |
| Sign-in | `ASWebAuthenticationSession` + PKCE, CryptoKit | platform |
| Device attestation | App Attest (DeviceCheck), client facade only | platform |
| Unit / UI tests | Swift Testing / XCUITest (`performAccessibilityAudit`) | Xcode **26.6** |
| Snapshot tests | swift-snapshot-testing (`Core/AedstDesignSystem` tests only) | **>= 1.19.7** |
| Errors / crashes / tracing | Sentry Cocoa | **9.32.0** |
| Analytics + feature flags | PostHog iOS | **3.93.6** |
| Push | APNs (`UserNotifications`) | platform |
| Media | AVKit, PhotosUI (PHPicker), ImageIO, AVFoundation, QuickLookThumbnailing, background `URLSession` | platform |
| Secrets / biometrics / network | Keychain (`Security`), `LocalAuthentication`, `Network` | platform |
| Offline write delivery | GRDB outbox + `NWPathMonitor` + `BGTaskScheduler` (`BGAppRefreshTask`), see [offline](/apple/offline) | platform / GRDB **7.12.0** |
| Diagnostics | MetricKit, `os.Logger` / `OSSignposter` | platform |
| Format / lint | swift-format (Xcode 26 toolchain) / SwiftLint (semantic rules) | toolchain / **0.65.1** |
| Signing / release | fastlane + match (Ruby, `Gemfile`) | **2.240.x** |
| Dependency updates | Renovate (repo-wide) | — |
| Symbols upload | sentry-cli | 3.8.0 |
