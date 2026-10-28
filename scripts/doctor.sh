#!/usr/bin/env bash
# `task doctor`: detect the toolchains on this machine and print, per platform, which verification
# level is possible (see docs/content/status.md). Read-only; never installs anything.
#   static   : only repo-wide scripts (naming, file size, colors, i18n, boundaries) can run
#   tests    : unit tests / typecheck / lint can run
#   build    : a real build can run (the acceptance test for Android, Apple, Desktop)
set -uo pipefail
cd "$(git rev-parse --show-toplevel)" 2>/dev/null || true

if [[ -z "${NO_COLOR:-}" && -t 1 ]]; then g=$'\033[32m' y=$'\033[33m' r=$'\033[31m' z=$'\033[0m'; else g="" y="" r="" z=""; fi
have() { command -v "$1" >/dev/null 2>&1; }
ver() { "$@" 2>&1 | head -1; }
row() { printf '  %-22s %s\n' "$1" "$2"; }
tool() { # tool <name> <cmd> [version-args...]
  local name="$1" cmd="$2"; shift 2
  if have "$cmd"; then row "$name" "${g}ok${z}  $(ver "$cmd" "$@")"; return 0; fi
  row "$name" "${r}missing${z}"; return 1
}
level() { printf '  => %s%s%s\n\n' "$2" "$1" "$z"; }
os="$(uname -s 2>/dev/null || echo unknown)"

echo "Repo-wide (always): bash, git, node"
tool git git --version; tool node node --version; tool pnpm pnpm --version; tool task task --version
echo "  => scripts/check-*.sh|mjs, task check:naming|file-size|colors|i18n|boundaries (static)"
echo

echo "server (Go)"
if tool go go version; then
  if have docker && docker info >/dev/null 2>&1; then row docker "${g}ok${z} (integration tests via Testcontainers)"; \
  else row docker "${y}unavailable${z} (set AEDST_TEST_DATABASE_URL for integration tests)"; fi
  level "tests (go build/vet/test); integration needs Docker or AEDST_TEST_DATABASE_URL" "$g"
else level "static only" "$r"; fi

echo "web (Next.js workspace: shared, app, admin, landing)"
if have node && have pnpm; then
  if [[ -d apps/web/node_modules ]]; then row node_modules "${g}installed${z}"; else row node_modules "${y}not installed${z} (pnpm --dir apps/web install --frozen-lockfile)"; fi
  level "tests + build (typecheck, Biome, knip, Vitest, next build); Playwright needs browsers" "$g"
else level "static only" "$r"; fi

echo "android (Kotlin / Gradle)"
if tool java java -version; then
  if [[ -n "${ANDROID_HOME:-}${ANDROID_SDK_ROOT:-}" ]]; then row android-sdk "${g}ok${z} ${ANDROID_HOME:-$ANDROID_SDK_ROOT}"; level "build (task android:generate android:lint android:test android:build)" "$g"
  else row android-sdk "${r}missing${z} (ANDROID_HOME)"; level "static only (JDK 21 without the SDK cannot compile)" "$y"; fi
else row android-sdk "n/a"; level "static only (uncompiled; first Gradle build is the acceptance test)" "$y"; fi

echo "apple (Swift / Xcode)"
if [[ "$os" == "Darwin" ]] && have xcodebuild; then
  tool xcodebuild xcodebuild -version; tool tuist tuist version
  level "build (task apple:generate apple:lint apple:test)" "$g"
else row xcodebuild "${r}not available${z} (macOS + Xcode 26.6 required)"; level "static only (never built; first tuist generate + xcodebuild is the acceptance test)" "$y"; fi

echo "desktop (C++ / Qt)"
ok=1
tool cmake cmake --version || ok=0
tool ninja ninja --version || true
if [[ -n "${VCPKG_ROOT:-}" ]]; then row VCPKG_ROOT "${g}ok${z} $VCPKG_ROOT"; else row VCPKG_ROOT "${r}unset${z}"; ok=0; fi
if [[ -n "${QT_ROOT_DIR:-}" ]]; then row QT_ROOT_DIR "${g}ok${z} $QT_ROOT_DIR"; else row QT_ROOT_DIR "${r}unset${z}"; ok=0; fi
if [[ $ok -eq 1 ]]; then level "build (task desktop:build desktop:test)" "$g"; else level "static only (never built; first CMake configure/compile is the acceptance test)" "$y"; fi

echo "other"
tool lefthook lefthook version || true
tool tofu tofu version || true
tool buf buf --version || true
echo
echo "Exact commands per platform: task verify:<server|web|android|apple|desktop>"
