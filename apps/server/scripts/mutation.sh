#!/usr/bin/env bash
# Mutation testing of the domain packages with gremlins (go-gremlins/gremlins).
# Fails when a package's test efficacy (killed / (killed + lived)) or mutant
# coverage drops below the thresholds. Packages without tests are skipped and
# listed: a domain package that has no tests is a gap to close, not to hide.
# Thresholds: docs/content/engineering/mutation-testing.md.
set -euo pipefail
cd "$(dirname "$0")/.."
efficacy="${MUTATION_EFFICACY_MIN:-65}"
mcover="${MUTATION_COVERAGE_MIN:-60}"
status=0
for dir in internal/modules/*/domain; do
  if ! compgen -G "$dir/*_test.go" >/dev/null; then
    echo "== $dir: SKIPPED (no tests)"
    continue
  fi
  echo "== $dir"
  # A timeout coefficient of 6 keeps slow cold `go test` starts (Windows, CI
  # cache misses) from counting as timed-out mutants.
  gremlins unleash "./$dir" --workers "${MUTATION_WORKERS:-2}" --timeout-coefficient 6 \
    --threshold-efficacy "$efficacy" --threshold-mcover "$mcover" || status=1
done
exit "$status"
