---
title: "Apple release, signing and App Store readiness"
description: "How the iOS and macOS apps get from main to TestFlight, the Mac App Store, or a notarized direct download. Everything here is fastlane + match driven by..."
---

# Apple release, signing and App Store readiness

How the iOS and macOS apps get from `main` to TestFlight, the Mac App Store, or a notarized direct download. Everything here is **fastlane + match driven by GitHub Actions** (`apps/apple/Gemfile`, `fastlane/{Appfile,Matchfile,Fastfile}`), running on `macos-26` with Xcode 26.6. This reverses the earlier "scripts only, no fastlane" decision: three targets (iOS, iPadOS, macOS) need managed certificates and profiles, and match gives reproducible signing ([decisions](/decisions)). Xcode Cloud was evaluated and not chosen (a second CI system beside GitHub Actions, configuration in the App Store Connect UI rather than the repo, `ci_post_clone.sh` needed for Tuist-generated projects, cost); revisit if the team drops GitHub Actions for Apple.

> **Verification status.** The fastlane lanes and the `apple-beta.yml` / `apple-release.yml` workflows were written without an Xcode or Ruby toolchain and **have never been run**. fastlane action parameters were checked against the fastlane 2.240.1 source, and manual signing through `update_code_signing_settings` on the Tuist-generated project overrides the xcconfig `CODE_SIGN_STYLE = Automatic` by Xcode's setting precedence (statically confirmed, **never run**). The first real run is the acceptance test; fix what it flags and update this page. CI (`apple-ci.yml`) is what proves the code compiles: its `app-build` job builds both app schemes.

## What is in the repo (so a release is only credentials away)

| Concern | Where |
|---|---|
| Hardened runtime (needed for notarization) | `Config/macOS.xcconfig` (`ENABLE_HARDENED_RUNTIME = YES`) |
| App Sandbox + network client entitlement | `App/macOS/AEDST.entitlements` |
| Release optimisation, dSYM, stripping | `Config/Release.xcconfig` |
| Signing (team id never committed) | Local development: `Config/Base.xcconfig` includes the gitignored `Config/Signing.local.xcconfig` (copy the `.example`). Release: certificates and profiles come from **match** (`fastlane/Matchfile`), team id from `APPLE_TEAM_ID` |
| Privacy manifests (tracking off; email, user id, device id collected for app functionality) | `App/iOS/PrivacyInfo.xcprivacy`, `App/macOS/PrivacyInfo.xcprivacy` |
| Face ID usage description, localized (en, ru, ar, tg, uz) | `App/iOS/Info.plist` + `App/iOS/Resources/*.lproj/InfoPlist.strings` |
| Export encryption compliance (`ITSAppUsesNonExemptEncryption = NO`: HTTPS only) | both `Info.plist` files |
| Lanes (archive, export, upload, notarize, staple) | `fastlane/Fastfile`: `ios beta`, `ios release`, `mac developer_id`, `mac app_store`, `match_sync`, `certs_check`; `make beta-ios`, `make release-ios`, `make release-macos`, `make signing-sync` |
| Build number | iOS: latest TestFlight build + 1; Developer ID: minutes since the Unix epoch (`BUILD_NUMBER` overrides) |
| Gated CI release | `.github/workflows/apple-release.yml` (manual, `apple-release` environment); TestFlight-only `.github/workflows/apple-beta.yml` (manual). Both use `ruby/setup-ruby` + `bundle exec fastlane` |
| Pre-release checks on every PR | `apple-ci.yml`: format check, plist/privacy/entitlements lint, unsigned Release build of both apps, privacy manifest present in the built `.app` |

## One-time setup (needs a paid Apple Developer Program account)

1. **App IDs**: register `com.aedst.apple.ios` and `com.aedst.apple.macos` (or change the prefix in `Project.swift`).
2. **App Store Connect API key** (Users and Access > Integrations > App Store Connect API, role *App Manager*): note the Key ID and Issuer ID, download the `.p8` once.
3. **match store**: create a private git repository (or an S3-compatible bucket) for the encrypted certificates and profiles, choose a `MATCH_PASSWORD`, then an admin runs `make signing-sync` locally (`bundle install` first) to create or refresh every certificate and profile (not readonly). CI only reads them (match is readonly when `CI=true`); `certs_check` fails when something is missing.
4. **GitHub Environment `apple-release`** with *required reviewers*, and these secrets:

   | Secret | Value |
   |---|---|
   | `APPLE_TEAM_ID` | 10-character team id |
   | `ASC_KEY_ID`, `ASC_ISSUER_ID` | from step 2 |
   | `ASC_KEY_CONTENT` | `base64 -i AuthKey_XXXX.p8` |
   | `MATCH_PASSWORD` | passphrase that encrypts the match store |
   | `MATCH_GIT_URL` | the match repository |
   | `MATCH_GIT_BASIC_AUTHORIZATION` | `base64("user:token")` for that repository (or use an SSH deploy key and an ssh `MATCH_GIT_URL`) |
   | `SENTRY_AUTH_TOKEN` (optional) + variables `SENTRY_ORG`, `SENTRY_PROJECT_APPLE` | dSYM upload to Sentry |
   | Optional S3 storage: `MATCH_STORAGE_MODE=s3`, `MATCH_S3_BUCKET`, `MATCH_S3_REGION`, `MATCH_S3_ACCESS_KEY`, `MATCH_S3_SECRET_ACCESS_KEY` | instead of the git store (see `fastlane/Matchfile`) |

   No longer used: `ASC_KEY_P8_BASE64`, `DEVELOPER_ID_CERT_P12_BASE64`, `DEVELOPER_ID_CERT_PASSWORD`, `APP_STORE_CONNECT_API_KEY_*` (delete them from the repository and environment).

   **Setting the secrets.** `apps/apple/scripts/set-github-secrets.sh` sets them with `gh` so no value passes through a command line or the shell history. Values come from environment variables (or `<NAME>_FILE` paths), never from arguments, and are never printed; `ASC_KEY_CONTENT` is computed from `ASC_KEY_P8_FILE`, and `MATCH_GIT_BASIC_AUTHORIZATION` from `MATCH_GIT_USER` + `MATCH_GIT_TOKEN`. It refuses to run when a required value is empty.

   ```sh
   cd apps/apple
   export APPLE_TEAM_ID=... ASC_KEY_ID=... ASC_ISSUER_ID=... MATCH_GIT_URL=... MATCH_GIT_USER=...
   export ASC_KEY_P8_FILE=~/keys/AuthKey_XXXX.p8
   read -rs MATCH_PASSWORD && export MATCH_PASSWORD          # prompts, no echo
   read -rs MATCH_GIT_TOKEN && export MATCH_GIT_TOKEN
   scripts/set-github-secrets.sh --environment apple-release --dry-run   # names only
   scripts/set-github-secrets.sh --environment apple-release             # for real
   scripts/set-github-secrets.sh --check-secrets --environment apple-release   # lists missing NAMES
   ```

   S3 match storage: `MATCH_STORAGE_MODE=s3` plus `MATCH_S3_BUCKET`, `MATCH_S3_REGION`, `MATCH_S3_ACCESS_KEY`, `MATCH_S3_SECRET_ACCESS_KEY` instead of the git variables. Optional: `SENTRY_AUTH_TOKEN` (secret), `SENTRY_ORG`, `SENTRY_PROJECT_APPLE` (variables). `--repo OWNER/REPO` targets another repository; without `--environment` the repository-level secrets are used. UNVERIFIED: the script was syntax-checked and dry-run against a stub `gh` only; the first real run is its acceptance test (`gh variable set` reading stdin and `gh secret list --json` need a recent `gh`).

5. **App Store Connect records** for both apps (name, bundle id, privacy policy URL, age rating, screenshots, export compliance answers, App Privacy "nutrition label" matching the privacy manifests).
6. Locally: `cp Config/Signing.local.xcconfig.example Config/Signing.local.xcconfig` and put your team id in it; `bundle install` for fastlane (Ruby 3.4.12 in `apps/apple/mise.toml`, verified as the latest 3.4 patch on 2026-10-28), then `make gem-lock` once on a Mac/Linux host and commit `Gemfile.lock`.

## Owner setup checklist (in order)

Everything here needs the owner's identity, money, or a console login, so none of it is automated or done by an agent. Do not paste any of these values into chat, issues or commits.

1. [ ] **Apple Developer Program** membership active (paid; cannot be automated: identity and payment). Note the 10-character Team ID.
2. [ ] **App IDs**: register `com.aedst.apple.ios` and `com.aedst.apple.macos` with capabilities **Push Notifications** and **Associated Domains** (developer.apple.com > Identifiers; the portal needs a signed-in human, and `match` does not enable capabilities). Regenerate provisioning profiles after changing capabilities (step 4).
3. [ ] **App Store Connect API key** (Users and Access > Integrations, role *App Manager*): record Key ID and Issuer ID, download the `.p8` once and keep it outside the repo. Cannot be automated: only an Account Holder/Admin can create keys, and the file is downloadable once.
4. [ ] **match repository**: create an empty *private* git repo (or S3 bucket), choose `MATCH_PASSWORD` (store it in your password manager), then locally `cd apps/apple && bundle install && bundle exec fastlane match_sync` (or `make signing-sync`). Needs your Apple ID/2FA or the API key; creates certificates under your account.
5. [ ] **ZITADEL**: run `apps/server/deployments/zitadel/bootstrap.sh` against your IdP (see `apps/server/deployments/zitadel/README.md`, "Apple app"; for production, with a PAT you created in the console). It registers the native app `aedst-apple` (redirect URI `com.aedst.apple:/oauth2redirect`) and prints the values. If you prefer the console: Applications > New > Native > PKCE, same redirect URI, JWT access tokens. In the console also enable passkeys in the login policy (not scripted).
6. [ ] **xcconfig**: put the printed `AEDST_OIDC_ISSUER`, `AEDST_OIDC_CLIENT_ID`, `AEDST_OIDC_AUDIENCE_SCOPE` into `apps/apple/Config/Secrets.local.xcconfig` (gitignored; issuer syntax `https:/$()/idp.example.com`), and set `AEDST_OIDC_WEBCREDENTIALS_DOMAIN` to the IdP host (no scheme). For CI/release builds the same keys must reach the build (see how the workflows pass build settings; the client id and issuer are public, the file itself stays uncommitted).
7. [ ] **apple-app-site-association** on the IdP host: serve this JSON at `https://<idp-host>/.well-known/apple-app-site-association` (HTTPS, status 200, `Content-Type: application/json`, no redirect, no file extension), replacing `<TEAMID>`:

   ```json
   { "webcredentials": { "apps": ["<TEAMID>.com.aedst.apple.ios", "<TEAMID>.com.aedst.apple.macos"] } }
   ```

   Done at your reverse proxy/CDN in front of ZITADEL (UNVERIFIED: ZITADEL itself is not known to serve this file). It is only needed for the system to offer passkeys/saved credentials in the sign-in sheet; sign-in works without it. Cannot be automated here: it is infrastructure only you control.
8. [ ] **GitHub environment** `apple-release` (Settings > Environments) with *required reviewers* (repository settings; needs admin rights).
9. [ ] **Secrets**: `scripts/set-github-secrets.sh --environment apple-release --dry-run`, then without `--dry-run`, then `--check-secrets` (see "Setting the secrets" above). Delete the obsolete secrets it reports.
10. [ ] **App Store Connect records** (step 5 of the one-time setup) and the "Checklist before the first submission" below.
11. [ ] Run **apple-beta**; the first run is the acceptance test of the lanes, so expect to fix something and update this page.

## Releasing

| Goal | Command |
|---|---|
| iOS build to TestFlight | run **apple-beta**, or **apple-release** with `ios-testflight`, or locally `make beta-ios` (`bundle exec fastlane ios beta`) |
| iOS build to App Store Connect (not submitted for review) | **apple-release** with `ios-app-store`, or `make release-ios` (`fastlane ios release`) |
| macOS notarized download | **apple-release** with `macos-developer-id` (artifact `AEDST-*.zip`), or `make release-macos` (`fastlane mac developer_id`) |
| macOS Mac App Store | **apple-release** with `macos-app-store`, or `DISTRIBUTION=app-store make release-macos` (`fastlane mac app_store`) |

The build number comes from fastlane (iOS: latest TestFlight build + 1; Developer ID: minutes since the Unix epoch; `BUILD_NUMBER` overrides it); the marketing version is `MARKETING_VERSION` in `Config/Base.xcconfig` (bump it by PR).

## Checklist before the first submission

- [ ] `make bootstrap` and a Debug run on a device and in the Simulator: login against a real server, kill and relaunch (session restored), airplane mode (offline banner, app still opens signed in), sign out.
- [ ] Xcode > Product > Archive > *Generate Privacy Report*: the aggregated report must match `PrivacyInfo.xcprivacy` and every third-party SDK's manifest (GRDB, swift-protobuf, connect-swift). Static audit result: app and local-package code uses no required-reason API (no UserDefaults, file timestamps, disk space, boot time). **Nuke 13.2.0 ships no `PrivacyInfo.xcprivacy`**; its `DataCache` (Caches directory, i.e. the app container) reads and sets `contentAccessDate` and reads `totalFileAllocatedSize` for the LRU sweep (`Sources/Nuke/Caching/DataCache.swift` lines 166, 348-368), and uses no UserDefaults, disk-space, boot-time or keyboard API. Both app manifests therefore declare only `NSPrivacyAccessedAPICategoryFileTimestamp` with `C617.1` (declared conservatively: Apple's published list names creation/modification dates, so whether the scanner counts the access date is UNVERIFIED). GRDB and swift-protobuf ship manifests with no accessed APIs; Sentry and PostHog ship manifests (UserDefaults `CA92.1`, boot time `35F9.1`, file timestamp `C617.1`); connect-swift ships none and uses no such API. Still manual: generate the report and compare it with the manifests; add any category it lists that the app or a manifest-less SDK uses, and drop `C617.1` if the report shows Nuke does not trigger it. If PostHog session replay is enabled (`AEDST_POSTHOG_SESSION_REPLAY`, default off, masked), re-check the App Privacy answers (usage data for analytics) against the report. App Attest is wired in (iOS device only, fail-open); its key id is a device identifier sent to our server for fraud prevention, which the existing `DeviceID` / App Functionality declaration already covers. It needs the **App Attest capability on the iOS App ID** and the `com.apple.developer.devicecheck.appattest-environment` entitlement (`APP_ATTEST_ENVIRONMENT`: development in Debug, production in Release); without them `DCAppAttestService` cannot create keys and, being fail-open, the app would silently never enroll. Confirm on a device that an attestation reaches the server (UNVERIFIED: never run) and that the server accepts the development AAGUID for debug builds.
- [ ] Accessibility Inspector pass with Dynamic Type at the largest sizes, VoiceOver, Reduce Motion, Increase Contrast, in light and dark.
- [ ] RTL check (Arabic): `-AppleLanguages (ar)` and `-NSDoubleLocalizedStrings YES` launch arguments.
- [ ] Verify on a device that `http://localhost` is only reachable in Debug: Release builds resolve to `production` (`APIEnvironment.resolve`, covered by tests) and the app declares no ATS exceptions.
- [ ] Confirm the Keychain posture still fits the product: tokens use `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` with `kSecAttrSynchronizable = false` (no iCloud sync, no backup). On macOS the items live in the data protection keychain (`kSecUseDataProtectionKeychain`), which needs a **signed** app; check on a signed Developer ID / App Store build that sign-in survives a relaunch (an unsigned build gets `errSecMissingEntitlement` and cannot keep a session).
- [ ] macOS: the app is a single window and quits when it closes (`Window` scene, `applicationShouldTerminateAfterLastWindowClosed`); check that Settings (Cmd-,) toggles show in the main window, that the sidebar and its shortcuts (Cmd-1..4, Cmd-F) work, and that a notification tap opens the right screen. iPad: full-screen shows the split view, Split View and Slide Over show the stack.
- [ ] Lock files: after the first Mac run commit every `Package.resolved` (`Tuist/`, each package) and `Gemfile.lock`; from then on `apple-ci` fails when a run changes a committed one.
- [ ] First run on a Mac: record the snapshot reference images (6 component groups x 6 iOS variants = 36 images on the iOS simulator; the macOS variants add 18 more if run on macOS) (`TEST_RUNNER_SNAPSHOT_TESTING_RECORD=all`; the first run fails) and commit `__Snapshots__`; run the XCUITest accessibility audit (`App_iOS_UITests`).
- [ ] Before enabling PostHog session replay (`AEDST_POSTHOG_SESSION_REPLAY`, default off) in production: confirm on a device that `ReplayConfiguration.masked` hides personal data. What the code asks for: `maskAllTextInputs` ("all text and text input fields" per the posthog-ios 3.90.2 source comment, there is no separate switch), `maskAllImages`, `maskAllSandboxedViews`, no network telemetry, screenshot mode. **Whether SwiftUI `Text` is really redacted in screenshot mode is UNVERIFIED**: inspect real replays of the task list, the composer and the admin screens. `aedstSensitive()` regions (personal and user-generated data) are an explicit second layer and do not depend on the SDK recognising SwiftUI views; do not enable replay in production until a recording shows no readable personal data. Replay runs on iOS only and only after consent.
- [ ] Browser sign-in: configure the ZITADEL native app (see the Apple README) and set `AEDST_OIDC_*`; fill the Associated Domains `webcredentials:` placeholder (`idp.example.invalid`) if used.

## Deliberately not in the repo

- **Universal Links** (`https://` deep links): they need an `apple-app-site-association` file served by the backend/website and the *Associated Domains* entitlement on a signed team. The custom scheme `aedst://login` works without either.
- **Sign in with Apple / native passkeys**: they require server support (identity provider configuration, `apps/server` ZITADEL/OIDC). Passkeys are provided by ZITADEL's hosted login inside the browser session; the app does not call the platform passkey API. App Store guideline 4.8 applies as soon as any third-party social login is added.
- **Device attestation**: the client side is wired (`AttestationCoordinator` in `AppDependencies`, `ConnectAppAttestRemote`) and the server verifies through its `appattest` module ([ADR-0016](/decisions/0016-device-attestation)). It has never run on a real device, so App Attest on-device behaviour is UNVERIFIED.
- **Push notifications** are in the repo: `aps-environment` is set from `$(APS_ENVIRONMENT)` (development in Debug, production in Release). Before release, enable Push Notifications on both App IDs, regenerate the provisioning profiles, and give the server an APNs `.p8` key (`AEDST_PUSH_APNS_*`). Release archives should run `apps/apple/scripts/upload-dsyms.sh <archive>` and pass `AEDST_SENTRY_DSN` / `AEDST_POSTHOG_KEY` as build settings.
- **Widgets, App Groups**: no product requirement yet; adding them means new entitlements and a new target each.
- **Keychain access group / shared session**: `Keychain(accessGroup:)` is ready, but sharing needs the `keychain-access-groups` entitlement and an extension target.
