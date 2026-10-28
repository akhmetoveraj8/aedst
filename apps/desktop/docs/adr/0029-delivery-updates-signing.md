# ADR-0029: Delivery - self-update, signing, repositories, reproducible builds

- Status: accepted (not compiled or run in the authoring environment; the Velopack adapter is written against an
  unverified API, see "Unverified")
- Scope: `apps/desktop` (`Aedst::Update`, `Aedst::Updater`, `App/`, `cmake/packaging/`, `packaging/`, `scripts/release/`,
  `.github/workflows/desktop-ci.yml`, `.github/workflows/desktop-release.yml`)

## Context

Phase 8 asked for: automatic updates on Windows and Linux (AppImage) with package signature verification, stable/beta
channels and rollback; updates through the repository for Flatpak, DEB and RPM; Authenticode signing in CI; an MSI next
to NSIS/MSIX; GPG-signed DEB/RPM repositories; a minimal Flatpak sandbox; reproducible builds.

## Decisions

### 1. Two layers of trust for self-updates

- **The Ed25519-signed manifest is the authority** (`Aedst::Update`, already in the tree): it names, per platform, the
  exact package (URL, SHA-256, size) and the version, channel, `minSupportedVersion`, `publishedAt` and an optional
  `rollback` flag. The public keys are compiled in (`AEDST_UPDATE_PUBLIC_KEYS`, several keys for rotation); the private
  key lives only in CI secrets. An empty key list disables the updater (fails closed).
- **Velopack is the transport and installer** (`Aedst::Updater`, `VelopackInstaller`): it reads its own release feed
  (`releases.<channel>.json`), downloads, and swaps the install on exit. Velopack has no publisher signature for packages,
  so the app does not trust its feed: `runUpdatePipeline` accepts a candidate only if its version, SHA-256 and size equal
  what the signed manifest declares, then verifies the downloaded file again (`ArtifactVerifier`) when the installer
  reports where the file is (NOT the case for Velopack, whose SDK exposes no path: Velopack verifies the package against
  the feed SHA-256 itself; see "Proposal awaiting the owner" at the end). A tampered feed or CDN
  cannot move a user to a package the release owner did not sign. Windows binaries and the setup are additionally
  Authenticode-signed (layer 2 for humans and SmartScreen).
- The pipeline never installs by itself: `UpdateService` ends in `ReadyToInstall`, the user presses "Restart to update"
  (mandatory updates cannot be postponed). Checks run on a worker thread, first after 2 minutes, then every 6 hours.

Alternatives rejected: Sparkle/WinSparkle (macOS-first / no Linux), a hand-written updater (library-first rule),
MSIX auto-update (needs the Store or an App Installer feed and a trusted certificate chain on every machine), using the
Velopack feed signatures alone (none exist for packages).

### 2. Channels and rollback

`stable` and `beta` are separate manifests (`stable.json`, `beta.json`) and separate Velopack feeds; the client accepts only
manifests of its own channel. A pre-release version (`1.7.0-beta.1`) is published to `beta` only (the release workflow
derives the channel from the tag). **Rollback** is a signed manifest with `"rollback": true` for an older version: the
client accepts it (a downgrade, and older than the newest version seen) and treats it as mandatory, but `publishedAt` must
still be newer than every manifest it has seen, so an attacker cannot replay an old, vulnerable manifest as a "rollback".
`StartupHealthGuard` counts starts that never became healthy (30 s up, or a clean exit); after 3 in a row the app starts in
safe mode (`crashLoop`): ordinary updates are not applied, the situation is logged, and only a signed rollback is installed.

### 3. Where each package type is updated

| Installation | Updated by |
|---|---|
| Windows setup / AppImage made by `vpk pack` | the app (Velopack) |
| Windows MSI (`package_msi`, WiX via CPack) | the deploying tool (GPO / Intune / SCCM) with a newer MSI of the same UpgradeCode |
| Windows NSIS / MSIX (CPack), portable ZIP | manual; the app only announces the signed offer |
| DEB / RPM | the APT / DNF repository (GPG-signed, `scripts/release/build-linux-repos.sh`); the app only announces |
| Flatpak | the Flatpak repository; the app only announces |

`ReportOnlyInstaller` is used whenever the app cannot replace itself (`VelopackInstaller::canSelfUpdate()` is false outside
a Velopack install, and Velopack is not compiled into DEB/RPM/Flatpak builds).

### 4. Signing

- **Update manifest**: `scripts/release/sign-update-manifest.sh` (OpenSSL `pkeyutl -rawin`, key from `AEDST_UPDATE_SIGNING_KEY`).
- **Windows**: `packaging/windows/sign.ps1` (signtool, SHA-256 + RFC 3161) in the package job; `vpk pack --signParams`
  signs what Velopack packs. **The certificate type is the owner's decision** (OV vs EV, token/HSM vs cloud signing such as
  Azure Trusted Signing) and is *not* made here: see `docs/signing.md`. Without secrets the workflow builds unsigned
  artifacts and says so.
- **Linux**: APT `InRelease` / `Release.gpg`, signed RPMs and `repomd.xml.asc` with one archive key; clients pin the key
  (`signed-by=`, `gpgkey=`).

### 5. Flatpak sandbox

`finish-args` are: ipc, network, wayland, fallback-x11, dri, pulseaudio, `talk-name=org.freedesktop.secrets` (QtKeychain),
`talk-name=org.kde.StatusNotifierWatcher` (tray). Removed as redundant: `org.freedesktop.Notifications` and
`org.freedesktop.portal.Desktop` (reachable from every sandbox by default). No filesystem access. QtKeychain is built as a
module (`AEDST_SYSTEM_QTKEYCHAIN=ON`) because the sandbox build has no network; all git sources carry tag and commit.

### 6. Reproducible builds

`/Brepro` (MSVC) and `-ffile-prefix-map` (GCC/Clang) via `AEDST_REPRODUCIBLE_BUILD`; build ids/PDB GUIDs from content;
`SOURCE_DATE_EPOCH` = commit time in CI for the packagers; vcpkg baseline pinned in `vcpkg.json (`builtin-baseline`)`; Qt pinned in
`qt-version.txt`; all GitHub Actions pinned by commit SHA (comment keeps the tag). Runner images are *not* pinned
(`windows-latest`, `ubuntu-latest`): bit-for-bit identical output across runner image updates is not claimed.

## Consequences

- New dependency: **Velopack** (MIT) C/C++ SDK `velopack_libc` 1.2.161 (CI `vpk` 1.2.161, exists on NuGet) - Library-First
  entry added. `vpk` needs the .NET SDK on the release runners only (.NET 10, `dotnet-version: "10.0.x"`; the 1.2.161 nupkg ships a `net10.0` tool build).
- New required secrets/variables are listed in `docs/release-runbook.md`; everything is optional and degrades to "unsigned,
  no update" with a visible workflow warning.

## Unverified (first real build and release are the acceptance tests)

- The C++ names used in `velopack_installer.cpp` and the layout of the `velopack_libc` zip (`cmake/AedstVelopack.cmake`).
- That QtNetworkAuth, libsecret and libcurl are in `org.kde.Platform//6.12`, and that 6.12 exists on Flathub at all.
- `vpk pack` flags on Linux (AppImage output), the nupkg file names the release workflow globs, and `--signParams` quoting.
- WiX through CPack (`package_msi`) with the installed WiX version.
- Reproducibility was not measured (no two builds were compared).

## Revisit when

- A signing certificate type is chosen (update `docs/signing.md`, wire the CI step to it).
- Velopack ships package signing, or its API changes (re-check the adapter).
- An arm64 build is added (`archName()` already reports `arm64`; the manifest needs an artifact for it).

## Proposal awaiting the owner: the independent re-hash of the downloaded package (nothing implemented)

The design is "hash the package again after the download and compare it with the SHA-256 of the signed manifest". For
Velopack that is **not done in the code**: `VelopackInstaller::download()` returns an empty path because the
C++ SDK does not expose where Velopack keeps the package, and the pipeline then skips the re-hash. What holds instead: the
manifest binds the SHA-256, size and version of the installer's own feed entry (checked before the download), and Velopack
verifies the package against the feed's SHA-256 itself.

Two honest ways out: **(a) amend this ADR and `SECURITY.md`** to state exactly that (the re-hash exists for installers that
return a path, i.e. report-only/AppImage flows, and not for Velopack), or **(b) make the re-hash mandatory** (an installer that
returns no path fails with an error, plus a pipeline test "empty download path = fail") and obtain the path from Velopack
(pin a package-directory convention or an SDK release that exposes it).

**Recommendation: (a) now, (b) when the SDK exposes the path.** (b) cannot be switched on safely today: the only production
installer would fail every update. The pipeline test for (b) is deliberately not added.
