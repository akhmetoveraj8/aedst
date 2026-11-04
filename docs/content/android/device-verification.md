---
title: Device verification
description: What the emulator lane proves for Android, and the exact manual runbook for what only a real device can prove.
---

# Device verification (Android)

Status honesty: none of the tests below has been run by the author of this page. The JVM gates (unit tests, lint,
ktlint, detekt, assemble) are the only verified level; see [status](/status). This page says which instrumented tests
exist, what they can and cannot prove, and what a human with a device must still do.

## 1. Automated: the emulator lane

`android-ci.yml` job `instrumented` runs on an API 34 x86_64 `google_apis` emulator (reactivecircus/android-emulator-runner):

```
./gradlew :core:ui:connectedDebugAndroidTest :feature:auth:connectedDebugAndroidTest \
          :core:security:connectedDebugAndroidTest :feature:notifications:connectedDebugAndroidTest
```

| Test | Proves | Does not prove |
|---|---|---|
| `core/security` `TinkEncryptedPreferencesInstrumentedTest` | Round trip on the real `AndroidKeyStore`; the file on disk is ciphertext; the Tink master key `aedst_secure_master_key` lives in the Keystore and does not export its material; an unprotected keyset is refused (fail closed) | StrongBox, hardware-backed attestation, behaviour after a lock-screen change or a factory-restore of app data |
| `feature/auth` `AuthTokenStoreInstrumentedTest` | A saved session is restored by a fresh `AuthTokenStore` over the same encrypted file; `clear()` removes it; an incomplete record restores as signed out (no AppAuth involved) | The OIDC flow itself (Custom Tab, redirect, ZITADEL) |
| `core/security` `PlayIntegrityFacadeInstrumentedTest` | Facade logic with a fake `StandardIntegrityManager` and real Google `Task` objects: warm-up once, request hash passed through, re-prepare after a failure, fail fast without a project number | That Google issues a token, that the server accepts it, any verdict |
| `feature/notifications` `PushRegistrarInstrumentedTest` | A real `FirebaseApp` with dummy options; the registration request (path, platform FCM, token) reaches the server; device id and token are remembered; an unchanged token is not re-sent; a rotated token or a new user is re-registered; a server failure is swallowed | Getting a token from FCM, receiving a message, notification display, the Android 13 permission prompt |
| `core/navigation` `AppLinkManifestTest` (JVM) | The real app manifest has exactly one `autoVerify` https `VIEW` filter, host `${appLinkHost}`, path prefixes equal to what `AedstRoutes` opens; `assetlinks.json.example` names `com.aedst.android` and holds no real fingerprint | That the OS verified the domain (section 3.4) |
| `core/ui` / `feature/auth` accessibility tests | Existing: Accessibility Test Framework checks | |

The `benchmarks` job of `android-nightly.yml` runs `StartupBenchmark` (cold start without compilation vs with the
profile) and `BaselineProfileGenerator`; emulator timings are not comparable with a device, the job proves the
benchmarks still run. `TaskListScrollBenchmark` and the signed-in journeys need a test account (see the README).

## 2. Baseline profile without a device

`android-baseline-profile.yml` (manual, and weekly on Monday 04:00 UTC) runs `:app:generateBaselineProfile` on the
emulator, uploads `android-baseline-profile` and opens or updates the pull request `android/baseline-profile` that
commits `apps/android/app/src/release/generated/baselineProfiles/`. Merge it, then set the repository variable
`AEDST_REQUIRE_BASELINE_PROFILE=1` so the folder cannot vanish silently (`scripts/check-baseline-profile.sh`).
The PR is opened with `GITHUB_TOKEN`, so close and reopen it to start `android-ci.yml`. Needs the repository setting
"Allow GitHub Actions to create and approve pull requests". Without the optional test account only the signed-out
journeys are in the profile; the signed-in task list is not.

## 3. Manual runbook for a real device

Use a physical device (Pixel-class, Android 14+, Google Play services, screen lock set). Record the device model,
Android build and the date next to each result before you update [status](/status).

### 3.1 Keystore and StrongBox

1. `./gradlew :core:security:connectedDebugAndroidTest` with the device connected (`adb devices`). All five tests pass.
2. Sign in, force-stop the app (`adb shell am force-stop com.aedst.android`), start it: the session is restored without
   a sign-in screen.
3. Change the screen lock (remove, then set again) and start the app. Expected: the app still opens. If the store
   reports corruption it resets to signed out (documented behaviour of `ReplaceFileCorruptionHandler`), never a crash and
   never plaintext tokens. Note which happened.
4. StrongBox: Tink's `AES256_GCM` master key is requested without a StrongBox flag, so it is TEE-backed where the device
   has one. Check the key's security level on a debug build via a short throwaway test:
   `KeyFactory`/`SecretKeyFactory` `getKeySpec(key, KeyInfo::class.java).securityLevel` for `aedst_secure_master_key`
   (`SECURITY_LEVEL_TRUSTED_ENVIRONMENT` or `SECURITY_LEVEL_STRONGBOX` is expected; `SOFTWARE` is a finding). A StrongBox
   requirement would be a new decision (decisions/android); today it is not required.
5. `adb shell run-as com.aedst.android ls files/datastore` shows `aedst_secure_store.pb`; `run-as ... cat` of it must not
   contain a token in the clear (debug build only).

### 3.2 Play Integrity (needs a Play-signed build)

The standard API only returns a verdict for an app installed from Google Play (internal testing track is enough).

1. Play Console: link a Google Cloud project, enable the Play Integrity API, note the project number.
2. Build the release bundle with `-Paedst.playIntegrityCloudProject=<number>` (or `PLAY_INTEGRITY_CLOUD_PROJECT`) and the
   usual signing/pins; upload to the internal track; install from the Play Store on the device.
3. Sign in. In Logcat filter by tag of `PlayIntegrityDeviceAttestor`; expect a token request and a call to
   `IntegrityService.VerifyIntegrityToken`. Server side: the verdict is recorded, decoded with Google's
   `decodeIntegrityToken`, and the `requestHash` matches. The result is informational today; nothing is enforced.
4. Negative checks: an emulator or sideloaded debug build must produce a failure or a weaker verdict, not a crash and not
   a blocked sign-in.

### 3.3 FCM

1. Create the Firebase project, download the real `google-services.json` to `apps/android/app/` (gitignored), enable
   Cloud Messaging; give the server the FCM credentials (`fcmCredentialsJson`).
2. Build and install a debug build; accept the notification permission (Android 13+).
3. Sign in; the server must have one `push device` row for the user with platform FCM (`PushRegistrar.sync`).
4. Send a test message from the Firebase console to the token (Logcat `FirebaseMessaging`). Foreground: the app's channel
   notification shows. Background: the system shows it; tap it and check the `link` extra opens the right screen.
5. Sign out: the server row is removed and the token is deleted (`PushRegistrar.unregister`); a push to the old token must
   not arrive. Sign in as another user: a new registration, no push of the previous account.
6. Optional: `adb shell cmd jobscheduler`/doze checks are out of scope here; note battery-optimised delivery separately.

### 3.4 App Links

1. Serve `https://<appLinkHost>/.well-known/assetlinks.json` (template `app/assetlinks.json.example`, served by the web
   app) with the package `com.aedst.android` and the SHA-256 of the signing certificate Play uses (Play Console > App
   integrity > App signing), plus the upload key for sideloaded release builds. Content type `application/json`, no
   redirect.
2. Build with `-Paedst.appLinkHost=<host>` and install.
3. Verification state:
   ```
   adb shell pm get-app-links com.aedst.android
   ```
   Expect `<host>: verified`. `none`, `1024` (no assetlinks) or `1026` (host mismatch) means it failed. Force a re-check:
   ```
   adb shell pm verify-app-links --re-verify com.aedst.android
   adb shell pm get-app-links --user cur com.aedst.android
   ```
   If the user-selection state is off: `adb shell pm set-app-links --package com.aedst.android 0 all`.
4. Open a link without a chooser:
   ```
   adb shell am start -a android.intent.action.VIEW -c android.intent.category.BROWSABLE \
     -d "https://<host>/tasks/<id>" com.aedst.android
   ```
   Expect the task detail, signed in or after sign-in. `https://<host>/unknown/1` must open the app on its start screen
   (rejected by `AedstRoutes`), not crash.
5. Cross-check from Google: `https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://<host>&relation=delegate_permission/common.handle_all_urls`.

### 3.5 Startup and profile

1. Merge the baseline-profile PR (section 2).
2. `./gradlew :benchmark:connectedBenchmarkReleaseAndroidTest -Paedst.allowUnpinnedRelease=true
   -Pandroid.testInstrumentationRunnerArguments.androidx.benchmark.enabledRules=macrobenchmark` on a physical device
   (not an emulator, no `suppressErrors`). Compare `startupColdSignedOutNoCompilation` with `...WithProfile`; record
   the medians here and in [status](/status).

## 4. What stays manual

Real Play Integrity verdicts, FCM delivery, StrongBox/TEE levels, OS-level App Link verification on a real domain,
real-device startup numbers, OEM battery and process-death behaviour, AppAuth against the production IdP. The emulator lane
makes regressions in the app-side logic visible; it does not replace these. Until a human has run section 3 and
recorded the result in [status](/status), do not claim "works on a device".
