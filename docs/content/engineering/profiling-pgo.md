---
title: "Profiling and PGO"
description: "Continuous profiling with the Grafana Pyroscope Go SDK behind the observability port, and profile-guided optimization from a k6 load profile, with the measured result so far."
---

# Profiling and PGO

## Continuous profiling

The server can push CPU and heap profiles (alloc/inuse objects and space) to a Pyroscope-compatible
backend. It is **off by default** and **push-only**: no port is opened.

- Port: `observability.Profiler` (`Stop(ctx)`), started by `observability.Setup` from
  `Config.Profiling` and stopped with the other telemetry shutdowns. The official SDK
  `github.com/grafana/pyroscope-go` is the adapter in `profiling_pyroscope.go`; depguard rule
  `pyroscope-only-in-observability` and `TestOnlyPlatformPackagesImportProviderSDKs` keep it there.
  OpenTelemetry stays the only instrumentation API for traces, metrics and logs.
- Backend: Grafana Cloud Profiles, or a Pyroscope server you already run. Self-hosting it is still
  excluded by default (see the decisions page).
- Configuration (`.env.example`, Helm `config.profiling` and `secretKeys.profilingBasicAuthPassword`):

| Variable | Meaning |
|---|---|
| `AEDST_PROFILING_ENABLED` | `true` turns it on; requires the server address |
| `AEDST_PROFILING_SERVER_ADDRESS` | e.g. `https://profiles-prod-001.grafana.net` |
| `AEDST_PROFILING_BASIC_AUTH_USER` / `_PASSWORD` | Grafana Cloud: stack user id and an access-policy token with `profiles:write` |
| `AEDST_PROFILING_TENANT_ID` | `X-Scope-OrgID` for a multi-tenant self-run backend |

Every profile carries the tags `env` and `version`; the application name is the service name. Mutex and
block profiles are not enabled: they need `runtime.SetMutexProfileFraction` / `SetBlockProfileRate`,
which cost throughput. `TestStartProfiling_UploadsToBackend` proves the adapter pushes to an
`/ingest` endpoint with the configured credentials. Ad-hoc inspection is still
`AEDST_PPROF_ENABLED` on the metrics listener, by port-forward only.

## PGO

Go applies a profile named `default.pgo` in the main package directory automatically (`-pgo=auto`),
so `cmd/server/default.pgo` also reaches the Docker build with no flag. `task pgo`
(`scripts/pgo.sh`) writes it:

1. `PGO_SOURCE=k6` (default when k6 is installed): start the server with `AEDST_PPROF_ENABLED=true`,
   `AEDST_METRICS_ADDR=:9090` and `AEDST_API_RATE_LIMIT_PER_MINUTE=0` (`task dev`), then run
   `task pgo TOKEN=<bearer>`. The script drives `test/load/api.js` (scenario `load`), pulls a 60 s CPU
   profile from `/debug/pprof/profile` while the arrival rate is on its plateau, and merges it with
   `go tool pprof -proto`.
2. `PGO_SOURCE=bench`: offline fallback with no Postgres or k6; profiles the benchmarks of the
   request-path code (token verification, App Attest, cursors).

### Measured result

Not yet representative, and said plainly: the machine this was written on has no Postgres, Docker or k6,
so **the k6 path was not run and is UNVERIFIED**. The bench profile was built and measured
(2026-11-18, Go 1.27.3, windows/amd64, 8 interleaved runs of 500 ms per benchmark, median ns/op,
`go test -pgo=off` against `-pgo=<profile>`):

| Benchmark | No PGO | PGO | Change |
|---|---|---|---|
| `VerifyAccessToken` | 78,888 | 79,964 | +1.4% |
| `VerifyAssertion` | 57,226 | 57,528 | +0.5% |
| `VerifyAttestation` | 920,346 | 911,340 | -1.0% |
| `CursorRoundTrip` | 435 | 447 | +2.7% |

That is noise: these functions are dominated by assembly crypto in the standard library, which PGO does
not touch, and the profile is in-sample. Server binary size moved from 83,446,272 to 83,645,440 bytes.
Decision: **no `default.pgo` is committed**. Record one from the real k6 load on a machine with
Postgres and k6, measure `task load SCENARIO=load` p95 and CPU per request with and without it, and
commit it only if the gain is real (typical PGO gains are 2-14% on CPU-bound request paths; that range is
a published expectation, not a measurement of this server).
