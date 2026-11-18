#!/usr/bin/env bash
# Runs every native Go fuzz target (func FuzzX) for FUZZTIME each (default 5s).
# `go test -fuzz` accepts one target in one package per run, so this discovers
# them and loops. A crash writes the failing input to <pkg>/testdata/fuzz/<Target>/
# (commit it: the file becomes a permanent regression test that plain `go test` replays).
#   scripts/fuzz.sh            # short run (task fuzz)
#   scripts/fuzz.sh 5m         # long run (nightly CI, task fuzz:long)
set -euo pipefail
cd "$(dirname "$0")/.."
fuzztime="${1:-5s}"
status=0
while IFS= read -r pkg; do
  for target in $(go test -list '^Fuzz' "$pkg" | grep '^Fuzz' || true); do
    echo "== $pkg $target ($fuzztime)"
    go test "$pkg" -run '^$' -fuzz "^${target}\$" -fuzztime "$fuzztime" || status=1
  done
done < <(grep -rl --include='*_test.go' -E '^func Fuzz[A-Z]' internal | xargs -n1 dirname | sort -u | sed 's#^#./#')
exit "$status"
