---
title: "Library-First: Desktop stack"
description: "Part of the Library-First standard. Principles, version policy, explicit rejections and the Definition of Done are in General rules."
---

# Library-First: Desktop stack

Part of the [Library-First standard](../library-first.md). Principles, version policy, explicit rejections and the Definition of Done are in [General rules](general.md).

> **Verification status:** `apps/desktop` has not been configured or built (no toolchain). Everything was statically reviewed; the first real build is the acceptance test. The connectrpc conformance suite is a **deferred follow-up** (not done).

Modern C++23, **Qt 6** (official binaries, currently 6.12.0; the version is `apps/desktop/qt-version.txt`, the single source of truth), CMake + CMakePresets, CTest, clang-tidy, clang-format (23.1.3, the PyPI wheel pinned in `desktop-ci.yml`). UI lives in `apps/desktop/Modules/Core/DesignSystem/`. Performance rules: `apps/desktop/docs/performance.md`.

Use the Qt API instead of home-grown equivalents: signals/slots instead of your own event system, `QTimer`, Qt filesystem/`std::filesystem`, Qt JSON, Qt Network, Qt concurrency, `std::unique_ptr`/`QPointer`. RAII, const-correctness, move semantics, no owning raw pointers.

| Responsibility | Tool |
|---|---|
| Package management | **vcpkg manifest mode** (`vcpkg.json`, `builtin-baseline`) for everything except Qt. Conan is **not used**: [ADR-0002](../../../apps/desktop/docs/adr/0002-dependency-management.md) |
| API contract | **protoc-generated C++ messages** (at build time, generated code is not committed, the same protoc as libprotobuf; **protobuf 7.x**, vcpkg port 7.36.2 = upstream v36.2, needs abseil >= 20250512.1) + a thin Connect-protocol client `ConnectClient` on Qt Network: [ADR-0001](../../../apps/desktop/docs/adr/0001-api-contract-client.md) |
| Validation | vendored protovalidate proto in `third_party/`, pinned by `buf.lock` (`scripts/check-protovalidate-pin.sh`, `scripts/check-proto-freshness.sh`) |
| Local DB | SQLite (vcpkg `sqlite3`) behind an RAII wrapper |
| Sign-in (OIDC) | **QtNetworkAuth** (**note: the license is GPLv3/commercial only, not LGPL; an open owner decision, ADR-0032**) (`QOAuth2AuthorizationCodeFlow` + PKCE S256 + `QOAuthHttpServerReplyHandler` on `127.0.0.1`, sign-in in the system browser) and **QtKeychain 0.17.0** (BSD-3-Clause; Windows Credential Manager, Linux Secret Service/KWallet) for the refresh token; built from source via `FetchContent` (statically, `EXCLUDE_FROM_ALL`), not through vcpkg (otherwise vcpkg would pull in its own Qt). No file fallback. Custom only: RFC 7009 token revocation (QtNetworkAuth has no API for it) and ID-token claim checks: [ADR-0025](../../../apps/desktop/docs/adr/0025-oidc-authentication.md) |
| TLS | Qt TLS backend: **Schannel** on Windows, **system OpenSSL** on Linux (from the runtime in Flatpak); `selectTlsBackend()` in `main.cpp`. OpenSSL from vcpkg remains only as a crypto library (AES-256-GCM, Ed25519, SHA-256, RAND): [ADR-0024](../../../apps/desktop/docs/adr/0024-build-dependencies-logging-tls.md) |
| Secret storage | Platform APIs, no new dependencies: DPAPI (Windows), libsecret (Linux, optional system package `libsecret-1-dev` via pkg-config); AES-256-GCM via OpenSSL EVP: [ADR-0003](../../../apps/desktop/docs/adr/0003-secret-storage.md) |
| Network reachability / i18n | `QNetworkInformation`; `QTranslator` + `qt_add_translations` (Qt Linguist); custom code only for language selection and RTL (`TranslationLoader`) |
| Platform services | `QLockFile`/`QLocalServer` (single instance), `QtDBus` (optional, Linux notifications), autostart via `QSettings`/`QSaveFile`; `QSystemTrayIcon` for native notifications (desktop has no FCM/APNs: unread items are polled with backoff), so Qt Widgets is linked. ADR-0022 partially supersedes [ADR-0006](../../../apps/desktop/docs/adr/0006-platform-services-and-updates.md) |
| Updates | Ed25519 + SHA-256 via OpenSSL EVP for the signed manifest (`Aedst::Update`, the source of truth) and **Velopack** (MIT, `velopack_libc` 1.2.161: download and install for Windows/AppImage; it is not in vcpkg, so a prebuilt zip from GitHub Releases is used with a pinned SHA-256; the CI tool `vpk` 1.2.161 comes from NuGet and needs the .NET SDK only on release runners). The Velopack feed is not trusted: the app checks version, SHA-256 and size against the signed manifest before downloading. DEB/RPM/Flatpak are updated by the repository, the app only reports. Custom code: the verification pipeline, `UpdateService`, `StartupHealthGuard` (safe mode): [ADR-0029](../../../apps/desktop/docs/adr/0029-delivery-updates-signing.md) |
| Crashes / errors | **sentry-native** (vcpkg, crashpad backend, `AEDST_ENABLE_SENTRY`); without a DSN, a local crash handler (`dbghelp` / `sigaction`); symbols in CI via `@sentry/cli` 3.8.0 (`releases new` → `debug-files upload` → `finalize`, release = `aedst-desktop@<package version>`); a single PII scrubber `core::scrubPii` (breadcrumbs, `before_send`, PostHog properties), crash reports only after consent: [ADR-0030](../../../apps/desktop/docs/adr/0030-observability-privacy.md) |
| Product analytics / feature flags | PostHog HTTP API via `QNetworkAccessManager` (no SDK), opt-in |
| Media | Qt Multimedia (`MediaPlayer` + `VideoOutput`, `QVideoSink` for previews), `QImageReader`/`QImageWriter` (compression), `QQuickImageProvider` with a cache |
| Transport policy | Qt API only (`QSslConfiguration`, pinning by SPKI SHA-256); `ignoreSslErrors` is forbidden: [ADR-0004](../../../apps/desktop/docs/adr/0004-transport-policy.md) |
| Tests / analysis / release | GoogleTest (`unit`), Qt Test (`qttest`), Qt Quick Test (`qmltest`); ASan/UBSan/TSan (`AEDST_SANITIZER`), gcovr (CI only), qmllint/qmlformat from Qt, clang-tidy (blocking, baseline); CPack (NSIS/ZIP, DEB/RPM/TGZ, DragNDrop/productbuild), `signtool`, `codesign`, `notarytool`/`stapler`, `objcopy`/`dsymutil` for symbols |

**Custom-code exception (documented, ADR-0001).** The thin Connect client is custom code because no ready-made Connect C++ client exists, and gRPC C++ duplicates Qt's HTTP/TLS/proxy stack and bypasses the OS certificate store. Rules for extending it:

- A new RPC = an entry in `contract/methods.hpp` (the descriptor drift test fails without it).
- Retries only for methods declared `Idempotent`.
- Client/bidi streaming is **not supported**; if such a need appears, revisit gRPC (see [decisions.md](../decisions.md)).

**Performance rules (`docs/performance.md`):** LTO in Release; compiler cache; mold/lld; QML is compiled ahead of time via `qt_add_qml_module` (plain `qt_add_resources` for production QML is forbidden); `QAbstractItemModel` with roles, not JS arrays; one long-lived `QNetworkAccessManager`; never ship `QT_QML_DEBUG`; trace "startup +N ms" before/after changes; `QBENCHMARK` for hot paths; PCH/mimalloc/unity build only with a measured gain.

**Logging: one sink, two entry points ([ADR-0024](../../../apps/desktop/docs/adr/0024-build-dependencies-logging-tls.md)).** `AedstLogger` (spdlog; rotation, JSON, secret redaction) is the sink and the entry point for Qt-independent code and GoogleTest. Qt code writes through `QLoggingCategory` (`aedst.*`, `Aedst::Logging`), and a message handler (`installQtLogBridge`) forwards the `aedst.*` categories at all levels to spdlog. **Two test frameworks is a deliberate decision:** GoogleTest/gMock is pure C++, Qt Test is for QObject/ViewModels. Do not create a third logger or framework.

## Enforced rules (one concern, one mandatory library; every gate has a fixture that must fail)

Machine-enforced from `apps/desktop` with bash/awk/node (no Qt, vcpkg or compiler needed); the same scripts run in `desktop-ci` (lint job) and, for the cheap ones, in lefthook. Every gate is exercised by `bash scripts/selftest/run-selftests.sh`: a fixture under `scripts/selftest/fixtures/` that **must fail** (and must name the rule id), a positive control that must pass, and the real tree. Escape hatch for a documented exception: `// aedst-allow: <reason>` on the line or the line above (a marker without a reason is itself an error); there is no allowlist file. Nothing here has been executed by CI yet.

| Concern | Mandatory | Forbidden (rule id) | Gate |
|---|---|---|---|
| TLS | Qt TLS backend, `QSslConfiguration`, SPKI pinning (ADR-0004) | `ignoreSslErrors` (`ssl-errors`) | `check-forbidden-apis.sh` |
| Threads | `QThreadPool`/`QtConcurrent`, QObject worker + `moveToThread`; the SQLite thread is `Core/Persistence` only (ADR-0028) | `: public QThread` (`qthread-subclass`); `std::thread`/`std::jthread` outside `Core/Persistence` (`std-thread`) | `check-forbidden-apis.sh` |
| HTTP | `ConnectClient` (one long-lived `QNetworkAccessManager`, `AppDependencies::network()`) | `QNetworkAccessManager` outside `Core/{Network,Oidc,Media,Telemetry,Update,Updater,Testing}` and the `App/src/app_dependencies.*` composition root (`qnam`) | `check-forbidden-apis.sh` |
| Secrets | `Core/Platform` secure storage, QtKeychain (ADR-0003, ADR-0025) | `QSettings`/`QFile`/`QSaveFile` in a non-test file that mentions token, password or secret (`secret-storage`) | `check-forbidden-apis.sh` |
| Logging | Qt-aware code: `qCDebug/qCWarning(lcX)` with the categories in `Aedst::Logging` (the one place that declares them); Qt-free layers: `AedstLogger` (ADR-0024) | bare `qDebug()/qWarning()/qInfo()/qCritical()` (`bare-qdebug`); `Q_LOGGING_CATEGORY`/`QLoggingCategory` declarations outside `Core/Logging` (`logging-category`); `AedstLogger::` in a file that includes Qt headers, outside `Core/Common` and tests (`logger-in-qt`) | `check-forbidden-apis.sh` |
| QML types | `QML_ELEMENT`/`QML_SINGLETON` + `static create()` in a `qt_add_qml_module`; instances handed over by `aedst::qmlsupport::SingletonSlot<T>::provide()` from `App/src/qml_singletons.cpp` | `qmlRegister*` outside tests (`qml-register`) | `check-forbidden-apis.sh` |
| Dependencies | a name in `vcpkg.json`, `Qt6`, or `compliance/components.json`; `FetchContent` pinned to a 40-hex commit or `URL` + `URL_HASH` | unknown `find_package` (`cmake-package`); unknown `FetchContent_Declare` name (`cmake-fetch-name`); tag/branch `GIT_TAG`, `URL` without hash, no pin (`cmake-fetch-pin`) | `check-forbidden-apis.sh` |
| UI controls | `Aedst*` components from `Core/DesignSystem` (`AedstLabel`, `AedstButton`, `AedstTextField`, `AedstListItem`, `AedstCircularProgress`, `AedstComboBox`, ...) | raw `Label/Text/Button/TextField/TextArea/ItemDelegate/BusyIndicator/ComboBox/CheckBox/Switch/RadioButton/Slider/ProgressBar/ToolTip` under `Modules/Features` and `App/qml` (`qml-raw-control`) | `check-qml-components.sh` |
| Accessibility | `Accessible.role` + `Accessible.name` | a QML file with `Button/TextField/TextArea/ItemDelegate/MouseArea/ComboBox/Switch/CheckBox/RadioButton/Slider/SpinBox/ToolButton/TabButton` and no `Accessible.role` or no `Accessible.name` (`qml-accessibility`; file-level by design) | `check-qml-accessibility.sh` |
| SQLite schema | one migration list, frozen by SHA-256 (ADR-0028) | editing a shipped migration, or appending one without recording its hash (`migration-hash`) | `check-migration-hashes.sh` (+ the CTest `SchemaHistoryTest`) |
| Strings | `qsTr()`/`tr()` + Qt Linguist catalogs in en, ru, tg, uz, ar | a source string missing from a locale, unfinished/empty, stale, `%n` without `numerus="yes"` and enough forms, changed `%1`/`%n` placeholders, a non-literal first argument (`i18n-*`) | `check-i18n-extract.mjs` (no Qt) and `check-i18n-lupdate.sh` (`lupdate -no-obsolete` in a temporary copy, needs Qt) |
| Feature layers | Domain (pure) <- Data, Presentation; features link Core only | Qt or `Data/`/`Presentation/` includes in `Domain/`; `Presentation/` in `Data/`; `Data/` in `Presentation/`; feature-to-feature links (`layer-*`) | `check-feature-boundaries.sh` |
| Static analysis | clang-tidy incl. `concurrency-*` and `misc-*` (Qt and generated headers ignored by `misc-include-cleaner`); naming and concurrency findings are errors | Windows-only code skipped by the Linux database | CI also runs `run-clang-tidy.sh` over the MSVC database (`AEDST_TIDY_ONLY_WINDOWS=1`, own baseline `clang-tidy-baseline-msvc.txt`; **UNVERIFIED** until the first run) |
| QML imports | resolve against the generated modules | an unresolved import with a build tree (`qmllint --import error`); without one only the import category is informational (`--import info`) | `check-qml-lint.sh` |

Known debt recorded on purpose: `scripts/i18n-baseline.json` counts the missing/unfinished translations per catalog (a shrink-only ratchet: it can only go down, and lowering it is required when translations land); one layer exception (`Tasks` presentation includes the outbox payload header from `Data/`) lives in `check-feature-boundaries.sh`. The translations themselves need native review before they are added.
