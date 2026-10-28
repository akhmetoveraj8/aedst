# ADR-0002: Dependency management — vcpkg (manifest mode) for C++ libraries, official binaries for Qt

- Status: accepted (not built in the authoring environment)
- Supersedes: Conan 2 (`conanfile.py`, removed)
- Scope: `apps/desktop`

## Context

Two package managers were on the table for the non-Qt C++ dependencies
(spdlog, fmt, sqlite3, OpenSSL, GoogleTest, protobuf — new with ADR-0001 — and
optionally Boost.Asio): Conan 2 (status quo) or vcpkg. Qt is a separate question.

### Qt: official binaries, pinned in one file

Qt is never built from a package manager: the ConanCenter and vcpkg Qt recipes
build Qt from source (hours; fragile across compilers) and would diverge from
what ships. Qt comes from the Qt online installer or `aqtinstall` (what CI uses
via `jurplel/install-qt-action`), found through `CMAKE_PREFIX_PATH` (presets read
`$QT_ROOT_DIR`).

**Single source of truth: `apps/desktop/qt-version.txt`** (`MAJOR.MINOR.PATCH`).

- CMake reads it (`cmake/AedstQtVersion.cmake`): the `find_package(Qt6 <major.minor>)`
  minimum comes from it everywhere, and configure **fails** if the installed
  Qt's major.minor differs (`-DAEDST_ENFORCE_QT_VERSION=OFF` to override; a
  patch difference only warns).
- CI and developers install from it:
  `aqt install-qt <os> desktop "$(cat apps/desktop/qt-version.txt)" <arch> -O ~/Qt`.
- Presets cannot read files; they only pass `$QT_ROOT_DIR`, so the version lives
  in exactly one place.

## Options for everything else

| | Conan 2 | vcpkg (manifest mode) |
|---|---|---|
| Configure flow | Two steps: `conan install` (per build type, into a folder the preset must point at), then `cmake --preset`. IDEs (Qt Creator, CLion, VS) do not run step one. | One step: the vcpkg toolchain file installs the manifest during `cmake --preset ...`. IDE-friendly. |
| Version pinning | Per-package versions in the recipe; lockfiles. | One `builtin-baseline` git commit pins every port version; per-package `overrides` when needed. |
| Freshness | ConanCenter lags on protobuf/abseil. | Ports track upstream closely (at the pinned baseline: protobuf 7.36.2, spdlog 1.17.0). |
| Binary caching | Server or local cache; needs a remote for CI speed. | Built-in providers (`files`, GitHub Actions cache, NuGet); preinstalled on GitHub runners (`VCPKG_INSTALLATION_ROOT`). |
| Windows/MSVC | Good. | Good; `x64-windows-static-md` gives static libs with the dynamic CRT Qt uses — nothing to copy next to test executables. |
| Ecosystem fit | Python tooling in the C++ build. | CMake-native, no Python. |
| Tool | Python + `pip install conan` | `git clone` + `bootstrap-vcpkg` (or the runner's copy). |

## Decision

**vcpkg manifest mode.** Rationale: the one-step configure removes the
`conan install`/`toolchainFile` folder choreography that the previous presets
needed, protobuf/abseil (now on the critical path) are current, CI gets binary
caching without running a server, and `cmake --preset` works identically from a
terminal and from an IDE. Consolidation is complete: `conanfile.py` is gone,
presets, README and the Flatpak manifest were updated.

Files:

- `vcpkg.json` — dependencies, `builtin-baseline`, features: `tests` (gtest, on
  by default; the `release` presets turn default features off).
- `CMakePresets.json` — toolchain `$env{VCPKG_ROOT}/scripts/buildsystems/vcpkg.cmake`;
  triplets `x64-windows-static-md` (MSVC) and `x64-linux` (GCC/Clang).
- Bumping a dependency: `vcpkg x-update-baseline` (updates `builtin-baseline`),
  commit, let CI rebuild. A single package: add an `overrides` entry.

Trade-offs accepted: baseline pinning is repo-wide rather than per-package;
first configure on a clean machine compiles protobuf + abseil (minutes;
binary-cache it in CI); `VCPKG_ROOT` must be set.

Flatpak builds do not use vcpkg (no network in the sandbox); they build
abseil/protobuf/spdlog/fmt as modules and use the KDE runtime's Qt/OpenSSL/SQLite.
The protobuf version there must match the vcpkg baseline's.

## CI migration (required; `.github/workflows/desktop-ci.yml` is outside this change)

The existing workflow still runs `conan install` and will fail until updated.
For each of the `test` and `build` jobs, replace the Conan steps
(`Install Conan`, `actions/cache` on `~/.conan2/p`, `Conan install`) and adjust
the Qt and configure steps:

```yaml
env:
  # QT_VERSION is read from the repo, not hard-coded here.
  VCPKG_BINARY_SOURCES: "clear;x-gha,readwrite"

steps:
  - uses: actions/checkout@v4

  - name: Read pinned Qt version
    run: echo "QT_VERSION=$(cat qt-version.txt)" >> "$GITHUB_ENV"     # bash; on Windows use shell: bash

  - uses: jurplel/install-qt-action@v4
    with:
      version: ${{ env.QT_VERSION }}
      cache: true

  - name: Export GitHub cache credentials for vcpkg binary caching
    uses: actions/github-script@v7
    with:
      script: |
        core.exportVariable('ACTIONS_CACHE_URL', process.env.ACTIONS_CACHE_URL || '');
        core.exportVariable('ACTIONS_RUNTIME_TOKEN', process.env.ACTIONS_RUNTIME_TOKEN || '');

  - name: Configure
    run: cmake --preset gcc-debug          # windows: msvc-release (after ilammy/msvc-dev-cmd)
    env:
      VCPKG_ROOT: ${{ env.VCPKG_INSTALLATION_ROOT }}

  - run: cmake --build --preset gcc-debug
  - run: ctest --preset gcc-debug
```

Also: `check-proto-freshness.sh` keeps working unchanged (it now checks the
method table against the protos); add `scripts/check-protovalidate-pin.sh` to
the `lint` job (needs `buf`); the `apps/server/api/proto/**` path filter stays.
A compiler matrix (`msvc-*`, `gcc-*`, `clang-*` presets) is the way to satisfy
"C++23 builds on all three".
