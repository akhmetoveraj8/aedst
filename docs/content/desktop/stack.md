---
title: Stack
description: The complete Desktop stack with exact versions.
---

# Desktop stack

C++23 / Qt 6 (`apps/desktop`). Versions are pinned in the repository (checked against the registries on **2026-10-28**). Approved-library rules and rejections: [Library-First](/library-first#desktop). How to bump versions: [Stack overview](/stack#keeping-it-current).

| Area | Tool | Version |
|---|---|---|
| Language | C++ | **C++23** |
| UI framework | Qt (QML via `qt_add_qml_module`, Widgets for the tray) | **6.12.0** |
| Build | CMake + presets, Ninja | ≥ 3.25 (CI 4.4.5) |
| Packages | vcpkg (manifest mode) | baseline `15b12b99` (vcpkg master of 2026-10-28; release 2026.10.16 still had protobuf 6.33.4) |
| API | protoc-generated messages + Qt-Network `ConnectClient` | protobuf **7.36.2** (upstream v36.2), abseil 20260107.1 |
| Logging | spdlog + fmt (and Qt logging, bridged) | **1.17.0** / 12.2.0 |
| Local DB | SQLite | 3.54.1 |
| Crypto / TLS | OpenSSL | 3.6.5 |
| Crashes / errors | sentry-native (crashpad) | 0.17.4 |
| Analytics + flags | PostHog HTTP API over `QNetworkAccessManager` | — |
| Media | Qt Multimedia, `QImageReader` / `QImageWriter` | Qt 6.12 |
| Sign-in | OIDC Authorization Code + PKCE via QtNetworkAuth (system browser), QtKeychain for the refresh token | Qt 6.12, QtKeychain **0.17.0** |
| Notifications | Windows toast (C++/WinRT), `org.freedesktop.Notifications` (QtDBus), `QSystemTrayIcon` fallback; live server stream when the server offers it, polling otherwise | Qt 6.12 |
| Tests | GoogleTest, Qt Test, Qt Quick Test | gtest **1.18.0** |
| Packaging | CPack (NSIS/ZIP, DEB/RPM/TGZ), Flatpak | — |
| Formatting | clang-format (PyPI wheel, pinned in `desktop-ci.yml`) | **23.1.3** |
| Release tooling | Velopack `vpk` on the .NET SDK (release runners only) | vpk **1.2.161** / .NET **10.0.x** (SDK 10.0.403) |

Desktop targets **Windows 10 22H2+/11 and Linux** only; macOS is served by `apps/apple` (ADR-0023). Full matrix: `apps/desktop/PLATFORM_SUPPORT.md`.
