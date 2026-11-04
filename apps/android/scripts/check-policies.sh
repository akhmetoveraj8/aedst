#!/usr/bin/env bash
# Library-First policy guards for apps/android that the compiler and linters cannot express
# (docs/content/library-first.md, docs/content/decisions.md). Run from CI's `lint` job next to
# check-feature-boundaries.sh.
#
#   1. kotlinx.serialization is for navigation keys and small local JSON only. The API contract is protobuf
#      (buf + connect-kotlin), so it must never appear in core/network or in a feature's data/remote|repository code.
#   2. Session replay: one tool at most (today none). PostHog session replay stays off; Sentry replay must not be
#      added next to it (double overhead, double consent).
#   3. Firebase is FCM only: no other Firebase artifact in the version catalog or in any module.
#   4. Cleartext HTTP is allowed only in src/debug network security configs (emulator loopback for a local IdP) and in
#      src/androidTest manifests (the test APK is never shipped; MockWebServer on 127.0.0.1); main and release source
#      sets, and every other manifest, must stay HTTPS-only.
#   5. No Color(0x...) literals outside the generated theme files; 6. Kotlin file-size policy (300/400/500 lines).
#   7. libs.versions.toml is a subset of the allowlist in docs/content/library-first/android.md.
#   8. UI tokens (no raw dp / RoundedCornerShape / literal Text outside core/ui) and a preview for every *Screen.kt.
#   9. AppRpcContract.kt matches the RPCs the code really calls.
set -euo pipefail

cd "$(dirname "$0")/.."

status=0
fail() {
  echo "::error::$1"
  status=1
}

# Optional first argument limits the run to one section (used by scripts/test-gates.sh): serialization, replay,
# firebase, cleartext, colors, filesize, catalog, tokens, rpc. No argument runs everything.
only="${1:-all}"
run() { [ "$only" = all ] || [ "$only" = "$1" ]; }

# 1. kotlinx.serialization outside its allowed scope. API-facing code = core/network, core/media, core/capabilities and
#    every `data` package of every feature or core module (recursively: data/remote, data/repository, data/oidc, ...).
#    @Serializable is forbidden there outright (a DTO class means a hand-written API payload); a kotlinx.serialization
#    import is allowed only in the files below, each with the reason (local JSON or an IdP tree, never an API payload).
serialization_allowed=(
  "core/media/src/main/kotlin/com/aedst/core/media/upload/UploadWorkData.kt"          # WorkManager input data: header map as local JSON
  "feature/auth/src/main/kotlin/com/aedst/feature/auth/data/local/AccessTokenClaims.kt"   # JWT claims read as a JsonObject tree
  "feature/auth/src/main/kotlin/com/aedst/feature/auth/data/oidc/OkHttpDeviceAuthorizer.kt" # IdP (RFC 8628) JSON as a tree, no DTOs
)
if run serialization; then
api_files=$( { find core/network/src/main core/media/src/main core/capabilities/src/main -name '*.kt' -not -path '*/kotlin-gen/*' 2>/dev/null
  find core feature -type d -path '*/src/main/kotlin/*' -name data -exec find {} -name '*.kt' \; 2>/dev/null; } | sort -u)
# Comment lines (KDoc/line comments) may mention the annotation; only code counts.
code_hits() { printf '%s\n' $api_files | tr '\n' '\0' | xargs -0 grep -nE "$1" 2>/dev/null | grep -vE ':[0-9]+:\s*(\*|//|/\*)' || true; }
hits=$(code_hits '@Serializable')
if [ -n "$hits" ]; then
  fail "@Serializable in API-facing code; the API is protobuf-only (a DTO class means a hand-written payload):"
  echo "$hits"
fi
while IFS= read -r line; do
  [ -z "$line" ] && continue
  file="${line%%:*}"
  allowed=0
  for ok in "${serialization_allowed[@]}"; do [ "${ok%% *}" = "$file" ] && allowed=1; done
  if [ "$allowed" -eq 0 ]; then
    fail "kotlinx.serialization used in API-facing code (allowlist with reasons is in scripts/check-policies.sh): $line"
  fi
done <<< "$(code_hits '^import kotlinx\.serialization')"
fi

# 2. Session replay: PostHog replay may only be switched on while Sentry replay is absent (and vice versa).
posthog_replay=$(grep -rnE --exclude-dir=build --include='*.kt' 'sessionReplays*=s*true' core feature app || true)
sentry_replay=$(grep -rniE --exclude-dir=build --include='*.kt' --include='*.kts' --include='*.toml' 'sentry-android-replay|SentryReplayOptions|sessionReplay.(on|error)' core feature app gradle || true)
if [ -n "$posthog_replay" ] && [ -n "$sentry_replay" ]; then
  fail "Session replay is configured in both PostHog and Sentry; keep one (decisions.md: single replay tool)."
  echo "$posthog_replay"
  echo "$sentry_replay"
fi

# 3. Firebase: messaging only.
extra_firebase=$(grep -rnE --exclude-dir=build --include='*.toml' --include='*.kts' 'com\.google\.firebase[:"]' gradle app app-tv core feature \
  | grep -vE 'firebase-bom|firebase-messaging|libs\.firebase\.(bom|messaging)' || true)
if [ -n "$extra_firebase" ]; then
  fail "A Firebase artifact other than Cloud Messaging is declared (Sentry = crashes, PostHog = analytics):"
  echo "$extra_firebase"
fi

# 4. Cleartext only in debug and androidTest source sets.
cleartext=$(grep -rnE --exclude-dir=build --include='*.xml' 'cleartextTrafficPermitted="true"|usesCleartextTraffic="true"' app app-tv benchmark core feature 2>/dev/null \
  | grep -vE '(^|/)src/(debug|androidTest)/|/build/' || true)
if [ -n "$cleartext" ]; then
  fail "Cleartext HTTP is enabled outside a src/debug source set (release must be HTTPS-only):"
  echo "$cleartext"
fi

# 5. Hand-written colors: only the generated theme palettes may contain Color(0x...) literals.
run colors && { bash scripts/check-color-literals.sh || status=1; }

# 6. File-size policy: > 500 lines fails, > 400 warns, > 300 is reported (see scripts/check-file-size.sh).
run filesize && { bash scripts/check-file-size.sh || status=1; }

# 7. Catalog allowlist, 8. UI tokens and screen previews, 9. RPC contract vs call sites (own scripts, each self-tested
#    by scripts/test-gates.sh).
run catalog && { bash scripts/check-catalog-allowlist.sh || status=1; }
run tokens && { bash scripts/check-ui-tokens.sh || status=1; }
run rpc && { bash scripts/check-rpc-contract.sh || status=1; }

if [ "$status" -eq 0 ]; then
  echo "OK: kotlinx.serialization scope, single session-replay tool and FCM-only Firebase and debug-only cleartext hold."
fi

exit "$status"
