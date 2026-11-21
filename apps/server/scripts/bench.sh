#!/usr/bin/env bash
# Run the gated benchmarks and write the Go benchmark output to a file that
# benchstat reads (scripts/bench-check.sh compares two of them).
#
#   scripts/bench.sh                 # -> bench.txt
#   scripts/bench.sh head.txt        # another output file
#   BENCH_COUNT=10 BENCH_TIME=1s scripts/bench.sh
#   BENCH_DIR=../base/apps/server scripts/bench.sh base.txt   # another checkout
#
# BENCH_PKGS is the list of hot-path packages under the regression gate. They
# need no database, container or network. A package that does not exist in the
# checkout being measured (an older base) is skipped. The crypto benchmarks
# (token verification, App Attest) are not listed: their cost is standard
# library assembly and they are the PGO fallback profile (scripts/pgo.sh).
set -euo pipefail

out="${1:-bench.txt}"
case "$out" in /* | [A-Za-z]:*) ;; *) out="$PWD/$out" ;; esac
cd "${BENCH_DIR:-$(dirname "$0")/..}"

BENCH_PKGS="${BENCH_PKGS:-./internal/shared/pagination ./internal/platform/idempotency ./internal/platform/events ./internal/platform/cache}"
count="${BENCH_COUNT:-6}"
benchtime="${BENCH_TIME:-200ms}"

pkgs=()
for p in $BENCH_PKGS; do
  if [ -d "$p" ]; then pkgs+=("$p"); else echo "bench: skipping $p (not in this checkout)" >&2; fi
done
if [ "${#pkgs[@]}" -eq 0 ]; then
  echo "bench: none of the benchmark packages exist here" >&2
  : >"$out"
  exit 0
fi

# -run '^$' runs no tests; -cpu 1 keeps the name suffix and the scheduler the
# same on every machine, so allocs/op is comparable between runs.
go test -run '^$' -bench . -benchmem -cpu 1 -count "$count" -benchtime "$benchtime" "${pkgs[@]}" | tee "$out"
