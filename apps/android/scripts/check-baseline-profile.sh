#!/usr/bin/env bash
# Honest status of the Baseline Profile (app/build.gradle.kts, README): the profile is recorded on a device or emulator
# (`./gradlew :app:generateBaselineProfile`) and committed under app/src/release/generated/baselineProfiles. Until that
# has happened the folder does not exist and release builds ship without a profile, so the default is a warning that
# says exactly that. Set AEDST_REQUIRE_BASELINE_PROFILE=1 (CI: repository variable) after the first recording, so the
# profile can no longer disappear silently.
#
# Usage: check-baseline-profile.sh [profile-dir]   (the argument exists for scripts/test-gates.sh)
set -euo pipefail

cd "$(dirname "$0")/.."

dir="${1:-app/src/release/generated/baselineProfiles}"

if [ -d "$dir" ] && [ -n "$(ls -A "$dir" 2>/dev/null)" ]; then
  echo "OK: baseline profile present in $dir"
  exit 0
fi

if [ "${AEDST_REQUIRE_BASELINE_PROFILE:-0}" = "1" ]; then
  echo "::error::No baseline profile in $dir. Record it with ./gradlew :app:generateBaselineProfile (device or emulator) and commit it."
  exit 1
fi

echo "::warning title=No baseline profile::$dir does not exist: no profile has been recorded, so release builds ship without one. Record it with ./gradlew :app:generateBaselineProfile and set AEDST_REQUIRE_BASELINE_PROFILE=1."
exit 0
