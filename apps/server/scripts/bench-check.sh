#!/usr/bin/env bash
# Benchmark regression gate: compare two outputs of scripts/bench.sh with
# benchstat and fail when a benchmark allocates more than the base.
#
#   scripts/bench-check.sh base.txt head.txt     # gate
#   scripts/bench-check.sh --selftest            # prove the gate can fail
#
# What fails: allocs/op that benchstat reports as a statistically significant
# increase (it prints "~" otherwise) of more than BENCH_MAX_ALLOC_REGRESSION_PCT
# percent (default 5), and any benchmark that went from 0 allocs/op to more.
# allocs/op is deterministic for this code, so the gate is stable on a shared
# CI runner. ns/op and B/op are printed for the reader and never gate: wall
# time on a shared runner is noise.
#
# benchstat is golang.org/x/perf/cmd/benchstat, the Go team's tool. The module
# has no tagged releases, so it is pinned by pseudo-version (the latest one,
# verified with `go list -m golang.org/x/perf@latest` on 2026-11-21) and run
# with `go run pkg@version`: nothing is added to go.mod.
set -euo pipefail

BENCHSTAT="golang.org/x/perf/cmd/benchstat@v0.0.0-20261117185222-4febdb082b2c"
threshold="${BENCH_MAX_ALLOC_REGRESSION_PCT:-5}"

# check <base> <head>: prints the report, returns 1 on a regression.
check() {
  local base="$1" head="$2" csv
  if [ ! -s "$base" ]; then
    echo "bench-check: $base has no results (no benchmark existed on the base): nothing to compare"
    return 0
  fi
  go run "$BENCHSTAT" "$base" "$head"
  csv="$(go run "$BENCHSTAT" -format csv "$base" "$head" 2>/dev/null)"
  # CSV rows are: name, base value, CI, head value, CI, "vs base", p. A table
  # starts with a header row whose second column is the unit.
  printf '%s\n' "$csv" | awk -F, -v max="$threshold" '
    $1 == "" && $2 != "" && $3 == "CI" { gated = ($2 == "allocs/op"); next }
    !gated || $1 == "" || $1 == "geomean" || NF < 7 { next }
    {
      delta = $6
      if (delta == "?" && $2 + 0 == 0 && $4 + 0 > 0) {
        printf "REGRESSION %s: 0 -> %s allocs/op\n", $1, $4; bad = 1; next
      }
      if (delta ~ /^\+[0-9.]+%$/) {
        pct = substr(delta, 2, length(delta) - 2) + 0
        if (pct > max + 0) { printf "REGRESSION %s: %s -> %s allocs/op (%s, limit +%s%%)\n", $1, $2, $4, delta, max; bad = 1 }
      }
    }
    END { exit bad }'
}

selftest() {
  local dir row
  dir="$(mktemp -d)"
  trap 'rm -rf "$dir"' RETURN
  row() { # row <name> <allocs> -> six benchmark lines
    local i
    for i in 1 2 3 4 5 6; do printf 'Benchmark%s \t 1000000 \t 100.0 ns/op \t 64 B/op \t %s allocs/op\n' "$1" "$2"; done
  }
  { echo "pkg: selftest"; row Steady 9; row Zero 0; } >"$dir/base.txt"
  { echo "pkg: selftest"; row Steady 9; row Zero 0; } >"$dir/same.txt"
  { echo "pkg: selftest"; row Steady 11; row Zero 0; } >"$dir/more.txt"
  { echo "pkg: selftest"; row Steady 9; row Zero 1; } >"$dir/fromzero.txt"
  { echo "pkg: selftest"; row Steady 7; row Zero 0; } >"$dir/fewer.txt"

  check "$dir/base.txt" "$dir/same.txt" >/dev/null || { echo "selftest: identical results were rejected" >&2; return 1; }
  check "$dir/base.txt" "$dir/fewer.txt" >/dev/null || { echo "selftest: an improvement was rejected" >&2; return 1; }
  if check "$dir/base.txt" "$dir/more.txt" >/dev/null; then echo "selftest: 9 -> 11 allocs/op passed the gate" >&2; return 1; fi
  if check "$dir/base.txt" "$dir/fromzero.txt" >/dev/null; then echo "selftest: 0 -> 1 allocs/op passed the gate" >&2; return 1; fi
  echo "bench-check selftest: ok (accepts equal and better, rejects +22% and 0 -> 1 allocs/op)"
}

if [ "${1:-}" = "--selftest" ]; then
  selftest
  exit $?
fi
if [ "$#" -ne 2 ]; then
  echo "usage: $0 <base.txt> <head.txt> | --selftest" >&2
  exit 2
fi
if check "$1" "$2"; then
  echo "bench-check: no allocation regression above +${threshold}%"
else
  echo "bench-check: allocation regression (see REGRESSION lines). Fix it, or justify it in the PR and raise the benchmark's baseline by merging." >&2
  exit 1
fi
