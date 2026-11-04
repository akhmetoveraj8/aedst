#!/usr/bin/env bash
# One entry point for the design-system pixel snapshots (Core/AedstDesignSystem). macOS + Xcode only.
#
#   scripts/snapshots.sh record   Re-record EVERY reference (iOS simulator + macOS), then verify them once.
#   scripts/snapshots.sh verify   Check against the recorded references. With no references for a platform it
#                                 skips that platform with a notice (exit 0); with references a diff fails.
#   scripts/snapshots.sh status   Print what is recorded and the environment it was recorded on.
#   scripts/snapshots.sh doctor   Print the scheme and simulator that would be used (and the raw Xcode lists).
#
# Why this exists: references are rasterizer-specific, so they must be recorded on the same Xcode / simulator
# runtime / macOS family that checks them, and they cannot be produced on a machine without Xcode. CI records
# them in the manual workflow .github/workflows/apple-record-snapshots.yml, which calls `record` here.
# Documented in docs/content/apple/snapshots.md.
#
# Simulator and scheme are DERIVED from what this Xcode reports (`xcodebuild -showdestinations` / `-list`), not
# guessed. Overrides (all optional):
#   SNAPSHOT_SIM_DEVICE  force a simulator name, e.g. "iPhone 17". Default: the base "iPhone <N>" model among the
#                        available destinations, newest iOS runtime first, then highest model number
#                        (deterministic, so record and verify on the same runner image agree).
#   SNAPSHOT_SIM_OS      force a runtime, e.g. "26.6". Default: the newest runtime offering the chosen device.
#   SNAPSHOT_SCHEME      force the scheme. Default: "<Package>-Package" if listed, else "<Package>", else the first.
# The choice is written to __Snapshots__/ENVIRONMENT.txt on `record`, so a runner image whose newest runtime changed
# produces one clear "re-record" message on `verify`, not dozens of pixel diffs.
#
# UNVERIFIED: written without a Swift toolchain, never run. The `-showdestinations` line format
# ("{ platform:iOS Simulator, arch:arm64, id:<udid>, OS:26.6, name:iPhone 17 }") is parsed from memory of Xcode's output;
# `doctor` prints the raw list so a mismatch is visible in one command.
set -euo pipefail

cd "$(dirname "$0")/.."

PACKAGE="Core/AedstDesignSystem"
SNAP_DIR="$PACKAGE/Tests/AedstDesignSystemTests/Snapshots/__Snapshots__"
REF_DIR="$SNAP_DIR/ComponentSnapshotTests"
ENV_FILE="$SNAP_DIR/ENVIRONMENT.txt"
RESULTS="${SNAPSHOT_RESULTS_DIR:-${RUNNER_TEMP:-/tmp}/aedst-snapshots}"

# Filled by resolve_targets.
SCHEME=""
SIM_DEVICE=""
SIM_OS=""
SIM_ID=""

mkdir -p "$RESULTS"

die() {
  echo "::error::$*" >&2
  exit 1
}

require_xcode() {
  command -v xcodebuild >/dev/null 2>&1 || die "xcodebuild not found: snapshots need macOS with Xcode"
}

has_references() { # ios | macos
  [ -d "$REF_DIR" ] || return 1
  case "$1" in
    ios) ls "$REF_DIR" | grep -Eq '(iphone|ipad)-.*\.png$' ;;
    macos) ls "$REF_DIR" | grep -Eq 'mac-.*\.png$' ;;
  esac
}

# Schemes of the package as Xcode lists them, one per line.
list_schemes() {
  (cd "$PACKAGE" && xcodebuild -list 2>/dev/null) |
    awk '/^ *Schemes:/ {on = 1; next} on && NF {sub(/^ +/, ""); print}'
}

pick_scheme() {
  if [ -n "${SNAPSHOT_SCHEME:-}" ]; then
    SCHEME="$SNAPSHOT_SCHEME"
    return
  fi
  local schemes name
  schemes="$(list_schemes)"
  name="$(basename "$PACKAGE")"
  if printf '%s\n' "$schemes" | grep -qxF "$name-Package"; then
    SCHEME="$name-Package"
  elif printf '%s\n' "$schemes" | grep -qxF "$name"; then
    SCHEME="$name"
  else
    SCHEME="$(printf '%s\n' "$schemes" | head -n 1)"
  fi
  [ -n "$SCHEME" ] || die "xcodebuild -list shows no scheme in $PACKAGE (set SNAPSHOT_SCHEME); output: $(cd "$PACKAGE" && xcodebuild -list 2>&1 | tail -n 20)"
}

# Available iOS Simulator destinations of $SCHEME as "sortkey|OS|name|udid" lines (sortkey = zero-padded OS version).
# Ineligible destinations (listed after their own heading) and the generic "Any iOS Simulator Device" are dropped.
ios_destinations() {
  (cd "$PACKAGE" && xcodebuild -showdestinations -scheme "$SCHEME" 2>/dev/null) |
    awk '/Ineligible destinations/ {exit} {print}' |
    grep 'platform:iOS Simulator' |
    grep -v 'Any iOS Simulator Device' |
    sed -nE 's/.*id:([^,]+), OS:([^,]+), name:([^}]*[^ }]) *\}.*/\2|\3|\1/p' |
    awk -F'|' '{n = split($1, v, "."); printf "%03d%03d%03d|%s|%s|%s\n", v[1], (n > 1 ? v[2] : 0), (n > 2 ? v[3] : 0), $1, $2, $3}'
}

pick_simulator() {
  local all candidates preferred choice
  all="$(ios_destinations)"
  if [ -z "$all" ]; then
    (cd "$PACKAGE" && xcodebuild -showdestinations -scheme "$SCHEME" 2>&1 | tail -n 30) >&2
    die "no available iOS Simulator destination for scheme $SCHEME"
  fi
  candidates="$all"
  if [ -n "${SNAPSHOT_SIM_OS:-}" ]; then
    candidates="$(printf '%s\n' "$candidates" | awk -F'|' -v os="$SNAPSHOT_SIM_OS" '$2 == os')"
  fi
  if [ -n "${SNAPSHOT_SIM_DEVICE:-}" ]; then
    candidates="$(printf '%s\n' "$candidates" | awk -F'|' -v n="$SNAPSHOT_SIM_DEVICE" '$3 == n')"
  else
    # Base phone models first ("iPhone 17"), then any iPhone.
    preferred="$(printf '%s\n' "$candidates" | grep -E '\|iPhone [0-9]+\|' || true)"
    [ -n "$preferred" ] || preferred="$(printf '%s\n' "$candidates" | grep -E '\|iPhone' || true)"
    candidates="$preferred"
  fi
  if [ -z "$candidates" ]; then
    printf 'available iOS Simulator destinations (sortkey|OS|name|udid):\n%s\n' "$all" >&2
    die "no simulator matches SNAPSHOT_SIM_DEVICE='${SNAPSHOT_SIM_DEVICE:-}' SNAPSHOT_SIM_OS='${SNAPSHOT_SIM_OS:-}'"
  fi
  choice="$(printf '%s\n' "$candidates" | sort -t'|' -k1,1r -k3,3r | head -n 1)"
  SIM_OS="$(printf '%s' "$choice" | cut -d'|' -f2)"
  SIM_DEVICE="$(printf '%s' "$choice" | cut -d'|' -f3)"
  SIM_ID="$(printf '%s' "$choice" | cut -d'|' -f4)"
}

# Resolves the scheme and the simulator once per invocation (needs Xcode).
resolve_targets() {
  pick_scheme
  pick_simulator
  echo "==> snapshots: scheme '$SCHEME', simulator '$SIM_DEVICE' iOS $SIM_OS ($SIM_ID)"
}

destination() { # ios | macos
  case "$1" in
    ios) echo "platform=iOS Simulator,id=$SIM_ID" ;;
    macos) echo "platform=macOS" ;;
  esac
}

# The environment a recording is only valid for: compared by `verify` so a drifted runner image produces one
# clear message instead of dozens of mysterious pixel diffs.
current_environment() {
  echo "xcode=$(xcodebuild -version | head -n 1)"
  echo "ios_simulator=$SIM_DEVICE iOS $SIM_OS"
  echo "macos_major=$(sw_vers -productVersion | cut -d. -f1)"
}

check_environment() {
  [ -f "$ENV_FILE" ] || die "$ENV_FILE is missing: references without a recorded environment cannot be trusted; re-record"
  if ! diff <(sort "$ENV_FILE") <(current_environment | sort) >"$RESULTS/env.diff"; then
    cat "$RESULTS/env.diff"
    die "references were recorded on a different environment (left: recorded, right: now). Re-record with the apple-record-snapshots workflow"
  fi
}

# run_tests <ios|macos> <record|verify>
run_tests() {
  local platform="$1" mode="$2" record_value="never" bundle="$RESULTS/$1-$2.xcresult"
  [ "$mode" = "record" ] && record_value="all"
  rm -rf "$bundle"
  echo "==> snapshots: $platform $mode ($(destination "$platform"))"
  (
    cd "$PACKAGE"
    # xcodebuild forwards TEST_RUNNER_* variables to the test process with the prefix stripped.
    TEST_RUNNER_AEDST_SNAPSHOTS="$mode" TEST_RUNNER_SNAPSHOT_TESTING_RECORD="$record_value" \
      xcodebuild test \
        -scheme "$SCHEME" \
        -destination "$(destination "$platform")" \
        -resultBundlePath "$bundle"
  )
}

doctor() {
  require_xcode
  echo "xcode: $(xcodebuild -version | tr '\n' ' ')"
  echo "schemes in $PACKAGE:"
  list_schemes | sed 's/^/  /'
  pick_scheme
  echo "available iOS Simulator destinations for $SCHEME (sortkey|OS|name|udid):"
  ios_destinations | sed 's/^/  /'
  pick_simulator
  echo "would use: scheme '$SCHEME', simulator '$SIM_DEVICE' iOS $SIM_OS ($SIM_ID)"
}

verify() {
  require_xcode
  local ran=0 resolved=0
  for platform in ios macos; do
    if has_references "$platform"; then
      if [ "$resolved" -eq 0 ]; then
        resolve_targets
        resolved=1
      fi
      check_environment
      run_tests "$platform" verify
      ran=1
    else
      echo "::notice::snapshots: no $platform references recorded; skipping (run the apple-record-snapshots workflow or 'scripts/snapshots.sh record' on a Mac)"
    fi
  done
  [ "$ran" -eq 1 ] || echo "snapshots: nothing to verify"
}

record() {
  require_xcode
  resolve_targets
  # Start clean: a renamed or deleted test must not leave a stale reference behind.
  rm -rf "$REF_DIR"
  mkdir -p "$SNAP_DIR"
  # A recording run reports every written image as an issue ("re-run to assert"), so its exit code is
  # expected to be non-zero. The verify pass below is what proves the recording is complete and stable.
  run_tests ios record || echo "(recording run reported the expected 'recorded' issues)"
  run_tests macos record || echo "(recording run reported the expected 'recorded' issues)"
  has_references ios || die "the iOS recording run wrote no references"
  has_references macos || die "the macOS recording run wrote no references"
  current_environment >"$ENV_FILE"
  echo "==> verifying the fresh recording (must pass without writing anything)"
  run_tests ios verify
  run_tests macos verify
  echo "Recorded $(ls "$REF_DIR" | wc -l | tr -d ' ') reference images in $REF_DIR"
}

status() {
  echo "references dir: $REF_DIR"
  for platform in ios macos; do
    if has_references "$platform"; then
      echo "$platform: $(ls "$REF_DIR" | grep -Ec "$([ "$platform" = ios ] && echo '(iphone|ipad)-' || echo 'mac-')") image(s)"
    else
      echo "$platform: none recorded"
    fi
  done
  if [ -f "$ENV_FILE" ]; then
    echo "recorded on:"
    sed 's/^/  /' "$ENV_FILE"
  fi
}

case "${1:-}" in
  record) record ;;
  verify) verify ;;
  status) status ;;
  doctor) doctor ;;
  *)
    echo "usage: $0 record|verify|status|doctor" >&2
    exit 2
    ;;
esac
