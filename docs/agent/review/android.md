# AI review prompt: apps/android

Review the pull request diff under `apps/android/`. Report findings only; do not push fixes.

## Read first

1. `apps/android/AGENTS.md` (situational rules) and `apps/android/README.md` (module layout, commands)
2. `docs/content/library-first/android.md` (approved stack, explicit rejections)
3. `docs/content/decisions/android.md` (recorded decisions; do not accept a contradicting change)
4. `docs/agent/conventions/android.md` (naming)

## Also check

- Module rules: a `feature:*` module does not depend on another feature's implementation; a `data:*` module depends on no other data module and no feature; `core:*` modules do not reach outside `core:*`.
- A Screen composable takes UI state and lambdas, not a ViewModel; no network call from the UI layer that bypasses the local store.
- Banned dependencies: `security-crypto`, Retrofit, Koin, `tv-foundation` lists; JDK stays at 21.
- Security: no token or PII logged, no cleartext traffic or newly exported component in the manifest, certificate pins and signing config are not hardcoded.
- Strings exist in all five locales (`scripts/check-i18n-parity.mjs`); no color literals (`scripts/check-color-literals.mjs`); generated token files are not hand-edited.
- `apps/android/Makefile` targets and ktlint/detekt rules still hold (`apps/android/detekt.yml`).

Post findings as a PR review. If nothing applies, approve with no comments.
