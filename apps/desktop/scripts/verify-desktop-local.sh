#!/usr/bin/env bash
# One-shot local verification: configure + build + test with a preset.
#
#   ./scripts/verify-desktop-local.sh [preset]      # default: host-appropriate debug preset
#   ./scripts/verify-desktop-local.sh gcc-asan
#   ./scripts/verify-desktop-local.sh --lint         # only the fast static checks
#
# Presets: msvc-debug gcc-debug clang-debug (+ -asan/-tsan variants,
# coverage). See CMakePresets.json. Checks that the required tools exist first and
# says how to get each missing one, instead of failing 30 seconds into cmake.
set -euo pipefail

cd "$(dirname "$0")/.."

missing=0
need() { # need <cmd> <hint>
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "missing: $1  ($2)" >&2
    missing=1
  fi
}

if [ "${1:-}" = "--lint" ]; then
  # The full desktop-ci.yml `lint` job set. A step whose tool is not installed is
  # SKIPPED (printed, counted, never reported as passed); a real failure fails the run.
  failed=()
  skipped=()
  passed=()
  # step <label> <required-binary|-> <command...>; exit 127 from a script means "its tool is missing".
  step() {
    local label="$1" bin="$2"
    shift 2
    echo "==> $label"
    if [ "$bin" != "-" ] && ! command -v "$bin" >/dev/null 2>&1; then
      echo "SKIPPED: $label ($bin not installed)"
      skipped+=("$label")
      return 0
    fi
    local rc=0
    "$@" || rc=$?
    if [ "$rc" -eq 0 ]; then
      passed+=("$label")
    elif [ "$rc" -eq 127 ]; then
      echo "SKIPPED: $label (tool not found, see message above)"
      skipped+=("$label")
    else
      echo "FAILED: $label (exit $rc)"
      failed+=("$label")
    fi
  }

  step "Qt module licenses (compliance qt)" node node ./scripts/compliance/compliance.mjs qt
  step "clang-format" - bash ./scripts/check-format.sh
  step "file naming" - bash ./scripts/check-naming.sh
  step "C++ subset" - bash ./scripts/check-cxx-subset.sh
  step "feature target boundaries" - bash ./scripts/check-feature-boundaries.sh
  step "proto freshness" - bash ./scripts/check-proto-freshness.sh
  # Needs the BSR; when buf.build is unreachable (offline) the step is skipped, not failed.
  if command -v buf >/dev/null 2>&1 && command -v curl >/dev/null 2>&1 \
    && ! curl -sS --max-time 5 -o /dev/null https://buf.build 2>/dev/null; then
    echo "==> protovalidate pin"
    echo "SKIPPED: protovalidate pin (buf.build unreachable)"
    skipped+=("protovalidate pin (buf.build unreachable)")
  else
    step "protovalidate pin (needs buf + network)" buf bash ./scripts/check-protovalidate-pin.sh
  fi
  step "qmllint" - bash ./scripts/check-qml-lint.sh
  # Advisory in CI (continue-on-error): reported, never fails the run.
  echo "==> qmlformat (advisory)"
  if bash ./scripts/check-qml-lint.sh --format; then
    passed+=("qmlformat (advisory)")
  else
    echo "NOTE: qmlformat differences or missing tool (advisory, not a failure)"
    skipped+=("qmlformat (advisory)")
  fi

  echo
  echo "desktop lint summary: ${#passed[@]} passed, ${#skipped[@]} skipped, ${#failed[@]} failed"
  for s in "${skipped[@]+"${skipped[@]}"}"; do echo "  SKIPPED: $s"; done
  for s in "${failed[@]+"${failed[@]}"}"; do echo "  FAILED:  $s"; done
  [ "${#failed[@]}" -eq 0 ] || exit 1
  [ "${#skipped[@]}" -eq 0 ] || echo "NOT FULLY VERIFIED: skipped steps did not run on this machine."
  exit 0
fi

preset="${1:-}"
if [ -z "$preset" ]; then
  case "$(uname -s)" in
    Linux)   preset=gcc-debug ;;
    MINGW*|MSYS*|CYGWIN*) preset=msvc-debug ;;
    *) echo "unknown host; pass a preset explicitly" >&2; exit 2 ;;
  esac
fi

need cmake  "https://cmake.org/download, >= 3.25 (CI uses 4.4.5)"
need ctest  "ships with cmake"
need ninja  "apt install ninja-build | VS installs one"

case "$preset" in
  gcc-*|coverage)  need g++ "apt install g++-13 or newer" ;;
  clang-*)         need clang++ "apt install clang-17 or newer" ;;
  msvc-*)          need cl "run from a VS 2022 Developer prompt (or vcvars64.bat) so Ninja finds cl.exe" ;;
esac
case "$preset" in
  coverage) need gcovr "pip install gcovr" ;;
esac

if [ -z "${VCPKG_ROOT:-}" ]; then
  echo "missing: VCPKG_ROOT is not set (clone https://github.com/microsoft/vcpkg and export VCPKG_ROOT)" >&2
  missing=1
elif [ ! -f "$VCPKG_ROOT/scripts/buildsystems/vcpkg.cmake" ]; then
  echo "missing: \$VCPKG_ROOT ($VCPKG_ROOT) does not contain scripts/buildsystems/vcpkg.cmake" >&2
  missing=1
fi
if [ -z "${QT_ROOT_DIR:-}" ]; then
  echo "missing: QT_ROOT_DIR is not set (Qt $(tr -d '[:space:]' < qt-version.txt) from the official installer/aqtinstall, e.g. .../6.12.0/gcc_64)" >&2
  missing=1
fi
[ "$(uname -s)" = Linux ] && ! pkg-config --exists libsecret-1 2>/dev/null \
  && echo "note: libsecret-1-dev not found; AedstPlatform falls back per its own CMake (apt install libsecret-1-dev)"

if [ "$missing" -ne 0 ]; then
  echo "verify-desktop-local: fix the items above and re-run." >&2
  exit 127
fi

export QT_QPA_PLATFORM=offscreen
echo "==> configure ($preset)"
cmake --preset "$preset"
echo "==> build ($preset)"
cmake --build --preset "$preset"
if [ "$preset" = coverage ]; then
  echo "==> coverage report"
  cmake --build --preset coverage-report
else
  echo "==> test ($preset)"
  ctest --preset "$preset"
fi
echo "verify-desktop-local: $preset OK"
