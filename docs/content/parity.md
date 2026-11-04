---
title: "Parity: one machine-checked matrix for all platforms"
description: "\"The clients are the same\" is a claim, so it is checked. Two artifacts make it checkable:"
---

# Parity: one machine-checked matrix for all platforms

"The clients are the same" is a claim, so it is checked. Two artifacts make it checkable:

| Artifact | What it pins | Checked by |
|---|---|---|
| `features.yaml` at the repo root | Feature x platform (server + web, android, apple, desktop) and behaviour x platform, each with a status and test evidence | `task check:features` |
| `docs/contract/behavior/*.json` | Language-neutral scenarios for shared behaviour (offline outbox, session refresh, client version gate, capability negotiation) | `task check:behavior` (reference model), plus a replay test per platform |

Both run on every PR in `policies-ci.yml` (job `parity`).

## Status vocabulary

| Status | Meaning |
|---|---|
| `verified` | Built and its tests ran on a real toolchain. Only allowed on platforms whose `verification` is `verified` (server, web, android). |
| `implemented` | Code and tests exist but were never compiled or run (apple and desktop until their first build). |
| `missing` | Not implemented. Requires a `tracking:` note. Allowed day to day; **forbidden at release** (`task check:features -- --require-complete`). |
| `na` | Does not apply. Requires a `reason:`. |

A behaviour can never claim more than its platform's verification level, and `implemented` or `verified` needs an `evidence` file that exists.

## What the check enforces

- The feature directories under each platform's feature root equal the list in `features.yaml`. An undeclared directory fails; a declared one that is gone fails.
- Every behaviour has an entry for every platform and a fixture file.
- No silent drift: adding a feature on one platform without declaring it on all five fails CI.

## Changing shared behaviour (the workflow that replaces "duplicate by hand")

1. Change the rule text and the cases in `docs/contract/behavior/<name>.json`.
2. Update `scripts/behavior/model.mjs` until `task check:behavior` passes. The model is the executable form of the written rules.
3. Each platform replays the same JSON in its own test suite, so a platform that disagrees fails its own build. The cost of a rule change is one fixture edit plus fixing whichever platform test goes red, instead of four unguided rewrites.

## Honest limits

- The matrix proves structure and the existence of evidence, not correctness. Android is `verified` on the JVM only (no device run); Apple and Desktop remain `implemented` (never `verified`) until their first real build ([status](/status)).
- Fixtures cover the rules that were worth pinning (outbox, session refresh, version gate, capabilities). Other behaviour is still covered per platform only.
