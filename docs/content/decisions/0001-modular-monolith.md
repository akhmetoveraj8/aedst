---
title: "ADR-0001: Start as a Modular Monolith"
description: "Accepted"
---

# ADR-0001: Start as a Modular Monolith

## Status
Accepted

## Context
AEDST is a template: it ships the global modules almost every product needs
(auth, tasks as the worked example, search, notifications, media, admin), and
each product built on it adds its own domains, across four client platforms (web, android, apple, desktop). A
microservices-first approach would front-load distributed-systems complexity
(service discovery, distributed transactions, network failure modes, per-service
CI/CD and observability) before any domain has proven it needs independent
scaling or deployment.

## Decision
Ship one deployable, `aedst-server`, containing every module as an internal
package with an enforced bounded-context boundary (see
[ADR-0006](/decisions/0006-module-boundaries)). Extract a module into its own service
only when a concrete operational reason exists (see
[architecture.md](/server/architecture#extraction-path)).

## Consequences
- Faster iteration and a single deploy/rollback unit while the product is
  finding its shape.
- Cross-module calls are Go function calls today (fast, easy to debug,
  transactionally simple) and become ConnectRPC calls after extraction — the
  contract shape doesn't change, only the transport.
- Requires discipline: nothing stops a developer from importing another
  module's internals except `architecturetest` in CI. That test is not
  optional.
- A bug or resource spike in one module can affect the whole process (shared
  memory/CPU/connections) until that module is extracted. Acceptable trade-off
  at current scale; mitigated by connection pool limits and by extracting the
  first module that actually hits this.
