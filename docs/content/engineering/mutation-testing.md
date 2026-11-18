---
title: "Fuzzing and mutation testing"
description: "Native Go fuzz targets for every parser of attacker-controlled bytes and gremlins mutation thresholds for the domain packages: what runs per PR, what runs nightly, and the measured baseline."
---

# Fuzzing and mutation testing

Unit tests prove the cases someone thought of. Fuzzing attacks the parsers with the cases nobody
thought of; mutation testing checks that the tests would notice if the code were wrong. Both are Go
toolchain features or one pinned tool, no new library in the server.

## Fuzzing

Native Go fuzz targets (`func FuzzX(f *testing.F)`), one per parser of attacker-controlled bytes:

| Package | Targets | Invariant besides "never panics" |
|---|---|---|
| `modules/appattest/infrastructure/apple` | `FuzzVerifyAttestation`, `FuzzVerifyAssertion`, `FuzzNonceFromCertificate` | a rejection never returns a key or counter; the ASN.1 nonce is never longer than its extension |
| `modules/appattest/domain` | `FuzzParseAttestationAuthData`, `FuzzDecodeKeyID` | accepted auth data is consistent with the short parser; a key id has exactly one accepted spelling |
| `platform/auth` | `FuzzRolesFromValue`, `FuzzRejectNonAccessToken`, `FuzzSameTokenType`, `FuzzCheckHeader` | a token with an ID-token claim is always rejected; an organisation-scoped role is never granted without the organisation; `typ` comparison is symmetric and never matches empty |
| `shared/pagination` | `FuzzDecode` | an accepted cursor belongs to the requested sort and survives `Encode`/`Decode` unchanged |

Seeds live in code (`f.Add`, including a valid attestation built by `appattesttest`) and in
`<pkg>/testdata/fuzz/<Target>/`. A crash writes its input to that directory: **commit it**, it becomes a
permanent regression test that plain `go test` replays. The first run found a real bug this way:
`DecodeKeyID` accepted base64 padded with CR/LF (the decoder skips them), so one key id had several
spellings; it now compares the canonical spelling (`testdata/fuzz/FuzzDecodeKeyID`).

| Command | Where | Cost |
|---|---|---|
| `go test ./...` | every PR (`task test`) | replays all seeds and committed crashers, milliseconds |
| `task fuzz` (`FUZZTIME`, default 3s per target) | `task check` | 10 targets, about 40 s including compiles |
| `task fuzz:long` (`FUZZTIME`, default 5m per target) | `server-nightly.yml` (02:17 UTC and on demand) | about 50 min; a crash uploads `server-fuzz-crashers` |

`scripts/fuzz.sh` discovers targets with `go test -list '^Fuzz'`, so a new `FuzzX` is picked up with no
Taskfile edit. **A new parser of untrusted bytes ships with a fuzz target.**

## Mutation testing

Tool: [`go-gremlins/gremlins`](https://github.com/go-gremlins/gremlins) v0.6.0 (latest in the module
proxy on 2026-11-18, pinned in `mise.toml`). It works on the AST and runs `go test` per mutant, so it is
independent of the Go version: verified on Go 1.27.3 by running it on all domain packages. go-mutesting
forks mutate by source rewriting and need per-fork Go-version compatibility checks; Stryker is the
equivalent on Web.

`task mutation` runs it on every `internal/modules/*/domain` package that has tests
(`scripts/mutation.sh`) and fails when a package drops below:

| Threshold | Default | Override |
|---|---|---|
| Test efficacy (killed / (killed + lived)) | 65% | `MUTATION_EFFICACY_MIN` |
| Mutant coverage (mutants the tests reach) | 60% | `MUTATION_COVERAGE_MIN` |

The thresholds sit below the lowest measured package (media, 70.7%; notifications mutant coverage,
66.7%) so noise does not flake the nightly job, and are raised when the baseline rises. A timeout
coefficient of 6 stops a cold `go test` start from counting as a timed-out mutant.

Baseline, 2026-11-18, Go 1.27.3:

| Domain package | Efficacy | Mutant coverage |
|---|---|---|
| admin | 100.00% | 100.00% |
| appattest | 76.67% | 90.91% |
| capabilities | skipped: no tests | skipped |
| integrity | 80.00% | 96.15% |
| media | 70.73% | 91.11% |
| notifications | 88.46% | 66.67% |
| search | 88.89% | 85.71% |
| tasks | 94.44% | 94.74% |

`capabilities/domain` has no test files; the script lists it as skipped. That is a gap to close, not a
pass. Mutation testing is minutes long, so it is nightly only (`server-nightly.yml`, job `mutation`),
never per PR. Surviving mutants are leads: read them with
`gremlins unleash ./internal/modules/<m>/domain -S l`, then either add the missing assertion or accept
the mutant as equivalent.
