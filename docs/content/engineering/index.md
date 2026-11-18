---
title: "Engineering standard"
description: "The senior-level quality bar for every AEDST change: modern language features, API design, security, performance and scalability, each mapped to the gate that enforces it."
---

# Engineering standard

This section is the quality bar for code written in AEDST, by people or by AI agents. It adapts the
roadmap.sh checklists (API Design, API Security, Frontend Performance, Backend Performance) to this
stack and says, for every item, whether a gate already enforces it or review must check it.

It sits on top of the existing rules and never overrides them: [Library-First](/library-first) decides
*which* code may exist, [decisions](/decisions) record *why*, and this section decides *how well* the code
that remains is written.

| Page | Covers |
|---|---|
| [Modern language features](/engineering/modern-language) | Which features of each pinned toolchain to use (Go 1.27, TypeScript 7 / React 19.3 / Next 16.4, Kotlin 2.4, Swift 6, Rust 2024), what is off limits, how it is enforced |
| [API design](/engineering/api-design) | ConnectRPC/Protobuf contracts: naming, resources, pagination, partial updates, idempotency, errors, auth, versioning, the new-RPC checklist |
| [Security](/engineering/security) | The API security checklist, item by item, with the file or gate that enforces it |
| [Performance](/engineering/performance) | CI budgets, frontend and backend rules, profiling, scaling order |
| [Fuzzing and mutation testing](/engineering/mutation-testing) | Go fuzz targets for parsers, gremlins thresholds for domain packages, what runs per PR and nightly |
| [Profiling and PGO](/engineering/profiling-pgo) | Pyroscope push profiling behind the observability port, `task pgo`, the measured PGO result |

## What "senior-level" means here

1. **Correct first.** Handle every error path, every unknown enum value, every empty and maximum input.
   Concurrency is designed, not hoped for: transactions, guarded SQL, idempotency keys, owned goroutines.
2. **Least code.** Library-First, then the platform, then existing repo code. The best change is the
   smallest one that fully solves the problem. No speculative abstraction, no dead options.
3. **Explicit contracts.** Types and Protobuf messages carry the invariants; validation sits at every
   boundary; public APIs are documented where they are declared.
4. **Secure and fast by default.** A new feature starts authenticated, validated, rate-limited, paged
   and budgeted. Opening any of these is an explicit, reviewed choice.
5. **Observable.** A new path emits the spans, metrics and structured logs needed to debug it in
   production without a redeploy, and nothing sensitive.
6. **Tested at the right level.** Domain logic by unit tests, SQL by integration tests, contracts by
   behaviour scenarios, user flows by e2e; a bug fix ships with the test that would have caught it.
7. **Readable.** Names from [CONVENTIONS](../../../CONVENTIONS.md), files under 300 lines, comments that
   explain *why*, code that matches its neighbours.
8. **Honest.** Verification is reported as it happened ([status](/status)); an unverified claim says
   `UNVERIFIED`.

## Scalability of the template

The template scales on three axes, each with its mechanism already in place:

- **Load**: stateless server replicas, connection pools, keyset pagination, River queues and separate
  worker Deployments, read replicas, then module extraction on measured triggers ([scaling](/server/scaling)).
- **Features**: vertical-slice modules (`task new:module`) registered through `modulekit` on the server
  and module manifests on the clients; no module imports another module's internals (architecture tests,
  `task check:boundaries`).
- **Teams and products**: `task template:new` derives a product repo by profile; contracts are versioned
  in Protobuf with `buf breaking`; every rule is a gate, so a new contributor or agent inherits it.

## How agents apply this

Agents read the short form in `docs/agent/quality-bar.md` on every task, open the page above that matches
the task, and run the `quality-pass` skill before reporting a change done. API work starts with the
`api-design` skill. Review checklists in `docs/agent/review/` point back here.
