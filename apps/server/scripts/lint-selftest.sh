#!/usr/bin/env bash
# Negative self-test of .golangci.yml: copies deliberately bad fixtures (scripts/lint-selftest/**,
# stored as *.go.txt so they never compile in the repo) into the tree, runs golangci-lint on
# them and fails unless every enforced rule fires. The copies are always removed.
# Do not run it while `go test ./architecturetest` runs: the fixtures add a fake module.
set -uo pipefail
cd "$(dirname "$0")/.."

src=scripts/lint-selftest
copies=()
cleanup() {
  for f in "${copies[@]}"; do rm -f "$f"; done
  rm -rf internal/modules/zzlintcheck internal/platform/zzlintcheck
}
trap cleanup EXIT

while IFS= read -r f; do
  dest="${f#"$src"/}"
  dest="${dest%.txt}"
  mkdir -p "$(dirname "$dest")"
  cp "$f" "$dest"
  copies+=("$dest")
done < <(find "$src" -name '*.go.txt')

run_lint() {
  golangci-lint run --timeout 10m --max-issues-per-linter 0 --max-same-issues 0 \
    ./internal/modules/zzlintcheck/... ./internal/platform/zzlintcheck/... 2>&1
}
out="$(run_lint)"
# Another go process scanning the tree can race with the temporary fixture directory
# ("typechecking error ... cannot find the path"); one retry keeps the gate deterministic.
for _ in 1 2 3 4 5 6 7 8; do
  grep -qE 'typechecking error|parallel golangci-lint is running' <<<"$out" || break
  sleep 15
  out="$(run_lint)"
done

fail=0
expect() {
  if ! grep -qE -- "$1" <<<"$out"; then
    echo "lint self-test FAILED: no finding matching /$1/ (rule: $2)" >&2
    fail=1
  fi
}
expect 'time-now:'                                  'forbidigo: time.Now in a module'
expect 'context-value:'                             'forbidigo: ctx.Value in application/domain'
expect 'std-log:'                                   'forbidigo: stdlib log'
expect 'fmt-print:'                                 'forbidigo: fmt.Print*'
expect 'default-http:'                              'forbidigo: http.DefaultClient'
expect 'should be used instead \(sloglint\)'        'sloglint: context'
expect 'string literal or a constant \(sloglint\)'  'sloglint: static message'
expect 'snake_case \(sloglint\)'                    'sloglint: key naming'
expect 'missing cases in'                    'exhaustive: sharederrors.Kind'
expect '\(spancheck\)'                              'spancheck'
expect '\(nilerr\)'                                 'nilerr'
expect '\(nolintlint\)'                             'nolintlint'
expect 'jwx-only-in-auth'                           'depguard: jwx'
expect 'prometheus-only-in-observability'           'depguard: prometheus'
expect 'otel-exporters-only-in-observability'       'depguard: otel exporters'
expect 'pyroscope-only-in-observability'          'depguard: pyroscope'
expect 'otelpgx-only-in-database'                    'depguard: otelpgx'
expect 'otelriver-only-in-jobs'                      'depguard: otelriver'
expect 'no-second-logger'                           'depguard: logrus'
expect 'errorsastype: .*\(modernize\)'                'modernize: errors.AsType'
expect 'waitgroupgo: .*\(modernize\)'                 'modernize: WaitGroup.Go'
expect '\(perfsprint\)'                             'perfsprint'
expect '\(usestdlibvars\)'                          'usestdlibvars'

if [ "$fail" -ne 0 ]; then
  echo "----- golangci-lint output -----" >&2
  echo "$out" >&2
  exit 1
fi
echo "lint self-test: every enforced rule fired on its fixture"
