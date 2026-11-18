#!/usr/bin/env bash
# Builds cmd/server/default.pgo, the profile `go build` picks up automatically
# (-pgo=auto, the default) for the main package. See docs/content/engineering/pgo.md.
#
#   PGO_SOURCE=k6     (default when k6 is on PATH) Profile a RUNNING server under the
#                     k6 load test (test/load/api.js): start it with
#                     AEDST_PPROF_ENABLED=true AEDST_METRICS_ADDR=:9090 and
#                     AEDST_API_RATE_LIMIT_PER_MINUTE=0 (task dev), pass TOKEN.
#   PGO_SOURCE=bench  Offline fallback with no Postgres/k6: CPU profiles of the
#                     benchmarks of the request-path code (auth, App Attest,
#                     pagination). Narrower than production traffic; a k6 profile
#                     replaces it as soon as one can be recorded.
#
#   BASE_URL (http://localhost:8080)  METRICS_URL (http://localhost:9090)
#   SECONDS_TO_PROFILE (60) profile length  RATE (50) / TOKEN: forwarded to k6
set -euo pipefail
cd "$(dirname "$0")/.."
out=cmd/server/default.pgo
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
source="${PGO_SOURCE:-}"
[ -n "$source" ] || { command -v k6 >/dev/null 2>&1 && source=k6 || source=bench; }

case "$source" in
k6)
  secs="${SECONDS_TO_PROFILE:-60}"
  curl -fsS "${METRICS_URL:-http://localhost:9090}/debug/pprof/cmdline" >/dev/null ||
    { echo "pgo: server pprof not reachable (AEDST_PPROF_ENABLED=true AEDST_METRICS_ADDR=:9090)" >&2; exit 1; }
  k6 run -e SCENARIO=load -e BASE_URL="${BASE_URL:-http://localhost:8080}" -e RATE="${RATE:-50}" \
    -e DURATION="$((secs + 10))s" -e TOKEN="${TOKEN:-}" test/load/api.js &
  k6pid=$!
  sleep 35 # k6 ramps up for 30s; profile only the held plateau
  curl -fsS -o "$tmp/cpu.pprof" "${METRICS_URL:-http://localhost:9090}/debug/pprof/profile?seconds=${secs}"
  wait "$k6pid" || true
  inputs=("$tmp/cpu.pprof")
  ;;
bench)
  inputs=()
  i=0
  for pkg in ./internal/platform/auth ./internal/modules/appattest/infrastructure/apple ./internal/shared/pagination; do
    i=$((i + 1))
    go test "$pkg" -run '^$' -bench . -benchtime "${BENCHTIME:-5s}" -cpuprofile "$tmp/cpu$i.pprof" -o "$tmp/t$i.test" >/dev/null
    inputs+=("$tmp/cpu$i.pprof")
  done
  ;;
*)
  echo "pgo: unknown PGO_SOURCE=$source (k6|bench)" >&2
  exit 1
  ;;
esac

# Merge into one profile (go tool pprof -proto sums samples); the toolchain's
# own documented flow for PGO inputs.
go tool pprof -proto "${inputs[@]}" >"$out" 2>/dev/null
echo "pgo: wrote $out from $source ($(wc -c <"$out") bytes)"
