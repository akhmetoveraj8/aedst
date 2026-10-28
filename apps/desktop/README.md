# AEDST Desktop

Qt 6 / QML desktop client for Windows and Linux (macOS is served by `apps/apple`). Same "monolith first, boundaries first" module architecture as
`apps/android` and `apps/apple` — see
[`docs/content/desktop/architecture.md`](../../docs/content/desktop/architecture.md) for how
the server's modules map onto CMake targets and why features never link each
other.

> **Not built in the authoring environment.** This tree (including the Connect
> client, generated-Protobuf contract, vcpkg migration and performance work) was
> written without a C++/Qt toolchain available. Run the Getting started steps
> below and fix anything the first real configure/compile flags; nothing here
> has been compiled, run, or benchmarked yet.

## Stack

| Concern | Choice |
|---|---|
| Language | C++23 (`std::expected`, designated initializers) |
| UI | Qt 6.12 Qt Quick / QML, Qt Quick Controls (Basic style) |
| Architecture | Module Architecture (Core libraries + Feature libraries + App composition root); MVVM + Clean Architecture (Domain / Data / Presentation / Navigation) per feature |
| Build | CMake ≥ 3.25 with `CMakePresets.json` (`msvc-*`, `gcc-*`, `clang-*`, sanitizer presets `*-asan`/`clang-tsan`, `coverage`, plus host-default `debug`/`release`/`bench`), Ninja; LTO, sccache/ccache, mold/lld auto-enabled — [performance.md](docs/performance.md) |
| Packages | vcpkg manifest mode (`vcpkg.json`) for everything except Qt — [ADR-0002](docs/adr/0002-dependency-management.md) |
| Qt itself | Official binaries (Qt installer / [aqtinstall](https://github.com/miurahr/aqtinstall)) at the version in `qt-version.txt` (single source of truth; CMake enforces it); found via `$QT_ROOT_DIR` |
| API contract | Generated Protobuf C++ messages (protoc at build time from `apps/server/api/proto`) + a thin Connect-protocol client on Qt Network (unary + server streaming, retries, deadlines, cancellation) — [ADR-0001](docs/adr/0001-api-contract-client.md); Boost.Asio optional for future low-level I/O |
| Database | SQLite (vcpkg `sqlite3`) behind a thin RAII wrapper (`AedstPersistence`) |
| Crypto / secrets | AES-256-GCM (OpenSSL) envelope; master key in DPAPI (Windows) / Secret Service via libsecret (Linux), `0600` key file only as fallback — [ADR-0003](docs/adr/0003-secret-storage.md) |
| Transport security | https required, TLS ≥ 1.2, optional SPKI pinning — [ADR-0004](docs/adr/0004-transport-policy.md) |
| Platform services | single instance, deep links, autostart, notifications, crash capture, signed-update verification, connectivity — [ADR-0006](docs/adr/0006-platform-services-and-updates.md) |
| Logging | spdlog (`AedstLogger`: console + rotating file) for app code; Qt `QLoggingCategory` reserved for Qt/QML framework messages |
| Tests | GoogleTest/gMock (pure C++, label `unit`) + Qt Test (`qttest`) + Qt Quick Test (`qmltest`), all via CTest; sanitizers and coverage in CI — [TESTING.md](TESTING.md) |
| Static analysis | clang-tidy (blocking in CI with a baseline), clang-format, qmllint, warnings-as-errors in CI, ASan/UBSan/TSan; PVS-Studio (local, licensed) |
| Docs | Doxygen (`Doxyfile` → `docs/generated/`) |
| IDE | Qt Creator (opens `CMakeLists.txt` / `CMakePresets.json` directly — no `.pro` files) |
| Packaging | Windows: NSIS/ZIP (CPack) + MSIX; Linux: DEB/RPM/TGZ (CPack), Flatpak, AppImage — signing when CI secrets exist — [packaging/README.md](packaging/README.md) |

## Layout

```
Modules/Core/{Common,Logging,Network,Contract,Oidc,Persistence,Outbox,Navigation,Plugin,Capabilities,Connectivity,Platform,CrashReporting,Telemetry,Update,Updater,Analytics,Media,DesignSystem,Testing}
                                  -> Aedst::Core, Aedst::Network, Aedst::Contract, ... (never depend on a feature)
Modules/Features/{Admin,Auth,Media,Notifications,Search,Tasks}
                                  -> Aedst::Feature::<Name> (depend on Core only; features never link each other)
App/                              -> aedst-desktop (the only target linking every feature)
Tests/                            -> label-scoped `check*` targets; tests live beside each module
cmake/, packaging/                -> warnings, CPack, NSIS/MSIX/Flatpak/AppImage
```

## Modules

Core modules (never depend on a feature):

| Target | Folder | Purpose |
|---|---|---|
| `Aedst::Core` | `Modules/Core/Common` | Qt-free foundation: `Outcome<T>` (`std::expected`), `Error`, `UseCase`, `Clock`, `AedstLogger` (redaction, JSON, correlation ids), `SecretString`/`secureWipe`, `invokeGuarded` |
| `Aedst::Logging` | `Modules/Core/Logging` | Qt logging categories (`lcApp`, `lcNetwork`, ...); a leaf module so no one needs a dependency on Telemetry to log |
| `Aedst::Contract` | `Modules/Core/Contract` | `methods.hpp` RPC descriptors (+ drift test); generated Protobuf messages (protoc at build time) |
| `Aedst::Network` | `Modules/Core/Network` | `ConnectClient` (Connect protocol on Qt Network: unary + server streaming, retries, deadlines, TLS/SPKI pinning, response size limit), `AuthInterceptor`, `ApiError` |
| `Aedst::Oidc` | `Modules/Core/Oidc` | OpenID Connect sign-in (Authorization Code + PKCE + nonce in the system browser), single-flight refresh, QtKeychain refresh-token store (ADR-0025) |
| `Aedst::Persistence` | `Modules/Core/Persistence` | RAII SQLite, `DatabaseWorker` (the one database thread), `SecureStorage` + `MasterKeyProvider` (DPAPI / libsecret / file fallback), `Migrator` (frozen migrations), `TokenStore`, `KvStore` |
| `Aedst::Outbox` | `Modules/Core/Outbox` | Offline write queue: SQLite outbox table, FIFO drainer, `OutboxService`; features contribute handlers through the plugin `ServiceRegistry` (ADR-0034) |
| `Aedst::Navigation` | `Modules/Core/Navigation` | Route names (`routes::*`, also the `Routes` QML singleton), `NavGraph` (route -> view, link prefixes), `Router` (back stack), `DeepLinkGate` (a link that arrives before sign-in waits for it) |
| `Aedst::Plugin` | `Modules/Core/Plugin` | `IFeaturePlugin`, `ServiceRegistry`, `PluginManager`, capability gating, trust policy (+ optional signed run-time loader); ADR-0033 |
| `Aedst::Capabilities` | `Modules/Core/Capabilities` | `GetCapabilities` client, shown-iff-built-AND-server-enabled rules, last-known cache, version advice (ADR-0035) |
| `Aedst::Connectivity` | `Modules/Core/Connectivity` | `QNetworkInformation` wrapper (Offline state for the UI, outbox, notification polling) |
| `Aedst::Platform` | `Modules/Core/Platform` | single instance, deep-link allow-list parser, autostart, notifications (toast / D-Bus / tray), platform info |
| `Aedst::CrashReporting` | `Modules/Core/CrashReporting` | local crash capture; the consent-gated uploader is library code that no production code wires (Sentry is the upload path) |
| `Aedst::Telemetry` | `Modules/Core/Telemetry` | `SentryReporter`, PostHog tracker, `ErrorCenter`, Qt-log -> spdlog bridge, PII scrubber (ADR-0022, ADR-0030) |
| `Aedst::Update` | `Modules/Core/Update` | Ed25519-signed manifest verification, semver, rollback protection, artifact hash check, startup health guard (ADR-0029) |
| `Aedst::Updater` | `Modules/Core/Updater` | self-update orchestration: `UpdateService` (own worker thread), pipeline, installer port; Velopack adapter (ADR-0029) |
| `Aedst::Analytics` | `Modules/Core/Analytics` | vendor-neutral `AnalyticsTracker` port + `NoOpAnalyticsTracker` |
| `Aedst::Media` | `Modules/Core/Media` | upload controller, presigned uploader, image provider and caches, video frame grabber, compression, `MediaRemoteDataSource` |
| `Aedst::QmlSupport` | `Modules/Core/QmlSupport` | `SingletonSlot<T>` for declarative QML singletons (`QML_ELEMENT` + `QML_SINGLETON`) |
| `Aedst::DesignSystem` | `Modules/Core/DesignSystem` | `ThemeController` + `AedstDesignSystem` QML module (generated tokens, `Theme`, ~45 components, translation loader) |
| `Aedst::Testing` | `Modules/Core/Testing` | test doubles (`FakeClock`, `FakeHttpServer` incl. an HTTPS mode, `StubTokenProvider`, behaviour fixtures); test targets only |

Feature modules (depend on Core only, never on each other):

| Target | Folder | Purpose |
|---|---|---|
| `Aedst::Feature::Auth` | `Modules/Features/Auth` | sign-in (password or browser/OIDC), session restore, `LoginViewModel`; the complete worked example |
| `Aedst::Feature::Tasks` | `Modules/Features/Tasks` | tasks list/detail/create with attachments and offline writes; the reference module |
| `Aedst::Feature::Search` | `Modules/Features/Search` | full-text search with suggestions, highlighted snippets |
| `Aedst::Feature::Notifications` | `Modules/Features/Notifications` | inbox, preferences, live stream with polling fallback, desktop notifications |
| `Aedst::Feature::Media` | `Modules/Features/Media` | "My files" library and the full-screen viewer (uses `Aedst::Media`) |
| `Aedst::Feature::Admin` | `Modules/Features/Admin` | operator screen: overview, users, audit log, broadcast (visible only with the admin role) |

The lists are checked against the tree by `scripts/check-docs-modules.sh`.

## Getting started

Full instructions per OS: [BUILDING.md](BUILDING.md). Prerequisites: a C++23 compiler (MSVC 19.37+ / VS 2022 17.7, GCC 13+, Clang 17+
with libstdc++ 13+), CMake ≥ 3.25, Ninja, git, [vcpkg](https://github.com/microsoft/vcpkg),
and Qt at the version pinned in `qt-version.txt`. Configure fails early, with a
message, if the compiler or Qt version is wrong.

```bash
# vcpkg (once): dependencies are installed automatically during `cmake --preset`
git clone https://github.com/microsoft/vcpkg ~/vcpkg && ~/vcpkg/bootstrap-vcpkg.sh   # Windows: bootstrap-vcpkg.bat
export VCPKG_ROOT=~/vcpkg                                       # PowerShell: $env:VCPKG_ROOT="C:\vcpkg"

# Qt via aqtinstall (or the official online installer) - version from qt-version.txt
pip install aqtinstall
aqt install-qt linux desktop "$(cat qt-version.txt)" linux_gcc_64 -O ~/Qt   # Windows: windows desktop <ver> win64_msvc2022_64
export QT_ROOT_DIR=~/Qt/$(cat qt-version.txt)/gcc_64                        # PowerShell: $env:QT_ROOT_DIR="C:\Qt\6.12.0\msvc2022_64"
```

Optional but recommended for build speed: `sccache` (or `ccache`), and `mold`
(or `lld`) on Linux — CMake picks them up automatically.

Debug build + tests (run from `apps/desktop`; on Windows from a "x64 Native
Tools" prompt so Ninja finds MSVC):

```bash
cmake --preset gcc-debug          # msvc-debug | clang-debug | debug (host default)
cmake --build --preset gcc-debug
ctest --preset gcc-debug          # or: debug-unit / debug-qttest (host-default preset)
```

The first configure builds protobuf + abseil (minutes); vcpkg's binary cache
(`VCPKG_BINARY_SOURCES`) makes later ones instant. Release: `cmake --preset
gcc-release && cmake --build --preset gcc-release` (LTO on, tests off).
Benchmarks: `cmake --preset bench && cmake --build --preset bench && ctest --preset bench -V`.

The generated Protobuf C++ comes from `../server/api/proto` (override with
`-DAEDST_PROTO_ROOT=...`).

Run it (Debug builds default to `http://localhost:8080`, i.e. `apps/server` running locally; Release builds **require** `AEDST_API_BASE_URL` to be an `https://` URL):

```bash
AEDST_API_BASE_URL=http://localhost:8080 ./build/gcc-debug/App/aedst-desktop
```

On Windows, put `%QT_ROOT_DIR%\bin` on `PATH` (or run `windeployqt`) before
launching from the build tree or running `ctest`. Startup phases are logged as
`startup +N ms: ...` in `<AppData>/logs/aedst.log`.

## Qt Creator

File → Open File or Project → `apps/desktop/CMakeLists.txt`. Qt Creator reads
`CMakePresets.json` and offers the presets as kits; set `VCPKG_ROOT` and
`QT_ROOT_DIR` in the environment Creator starts from (vcpkg installs during the
CMake configure step — no separate command). Set the kit's Qt version to the one
in `qt-version.txt` and leave "QML debugging" **off** for Release kits (configure
refuses `QT_QML_DEBUG` in Release). There are no `.pro`/qmake files.

## Tests

- **GoogleTest / gMock** — Domain use cases, repositories, error model, Connect
  envelope/retry/error vectors, Protobuf golden bytes and the method-table drift
  guard (`Modules/**/tests/*_test.cpp`, CTest label `unit`). `ConnectClient` is
  tested end to end against a loopback `FakeHttpServer` (real
  `QNetworkAccessManager`, real generated messages).
- **Qt Test** — QObject ViewModels with `QSignalSpy`
  (`Modules/Features/Auth/tests/login_view_model_test.cpp`, label `qttest`), run
  with `QT_QPA_PLATFORM=offscreen`; `QBENCHMARK` benchmarks (label `bench`, only
  in the `bench` preset).
- Convenience targets: `cmake --build --preset debug --target check-unit` /
  `check-qttest` / `check`.

Adding an RPC on the server: the desktop build regenerates the messages
automatically; add its entry to `Modules/Core/Contract/include/aedst/contract/methods.hpp`
(the lint script `scripts/check-proto-freshness.sh` and `methods_test.cpp` fail
until you do).

## Static analysis

```bash
# formatting: clang-format 23.1.3 (the PyPI wheel, `pip install clang-format==23.1.3`); CI runs the check
CLANG_FORMAT_VERSION=23.1.3 ./scripts/check-format.sh        # --dry-run --Werror
CLANG_FORMAT_VERSION=23.1.3 ./scripts/check-format.sh --fix  # rewrite in place

# clang-tidy (blocking in CI; baseline in scripts/clang-tidy-baseline.txt)
./scripts/run-clang-tidy.sh build/clang-debug
# QML lint
./scripts/check-qml-lint.sh
# or build with it inline: cmake --preset gcc-debug -DAEDST_ENABLE_CLANG_TIDY=ON
```

**PVS-Studio** needs a license (free for open source / students, trial
otherwise), so it isn't wired into CI. Local usage against the same
compilation database:

```bash
pvs-studio-analyzer credentials <name> <key>                     # once
pvs-studio-analyzer analyze -f build/gcc-debug/compile_commands.json \
    -e build/ -j8 -o build/pvs.log
plog-converter -a GA:1,2 -t fullhtml build/pvs.log -o build/pvs-report
```

(Windows: `CompilerCommandsAnalyzer.exe analyze --cfg ...` with the same
`compile_commands.json`, or the Visual Studio plugin.)

## Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md) · [CODING_STANDARDS.md](CODING_STANDARDS.md) · [BUILDING.md](BUILDING.md) · [TESTING.md](TESTING.md) · [SECURITY.md](SECURITY.md) · [CONTRIBUTING.md](CONTRIBUTING.md) · [PLATFORM_SUPPORT.md](PLATFORM_SUPPORT.md)
- [ADR-0001 API contract client](docs/adr/0001-api-contract-client.md) - Connect over Qt Network + generated Protobuf, why not gRPC C++
- [ADR-0002 dependency management](docs/adr/0002-dependency-management.md) - vcpkg, Qt pin, CI migration
- [ADR-0003 secret storage](docs/adr/0003-secret-storage.md), [0004 transport policy](docs/adr/0004-transport-policy.md), [0005 database & threading](docs/adr/0005-local-database-and-threading.md), [0006 platform services & updates](docs/adr/0006-platform-services-and-updates.md)
- [ADR-0022 to 0036](docs/adr/): telemetry/media/notifications, Windows and Linux only, OIDC, API client hardening, realtime notifications, local data thread, delivery/updates/signing, observability privacy, performance gate, licenses, feature plugins (0033), offline outbox and client gate (0034), capability negotiation (0035), power and resume (0036)
- [Performance baseline](docs/performance.md) - build/runtime switches, measuring, what was deliberately not done

```bash
doxygen Doxyfile        # -> docs/generated/html/index.html (gitignored)
```

## Packaging

From a configured **release** tree (`<release-preset>` = `msvc-release`, `gcc-release`, ...):

| Target / command | Output | Notes |
|---|---|---|
| `cpack --config build/<release-preset>/CPackConfig.cmake` | NSIS `.exe` + `.zip` (Windows), `.deb` + `.tar.gz` (Linux) | CI path |
| `cmake --build --preset <release-preset> --target package_nsis` | NSIS from `packaging/windows/installer.nsi.in` | needs `makensis` |
| `cmake --build --preset <release-preset> --target package_msix` | unsigned `.msix` | needs Windows SDK `makeappx`/`makepri`; signing is a scope cut |
| `cmake --build --preset <release-preset> --target package_appimage` | `.AppImage` | configure with `-DAEDST_DEPLOY_QT=OFF`; needs `linuxdeploy` + Qt plugin and a real icon |
| `cmake --build --preset <release-preset> --target package_flatpak` | `.flatpak` bundle | needs `flatpak-builder`; builds against `org.kde.Platform` 6.12 |

Artifacts land in `build/<preset>/packages/`. Icons are placeholders — see
`App/resources/icons/README.md`.
