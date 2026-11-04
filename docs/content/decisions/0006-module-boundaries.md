---
title: "ADR-0006: Enforced module boundaries via architecture tests"
description: "Accepted"
---

# ADR-0006: Enforced module boundaries via architecture tests

## Status
Accepted

## Context
ADR-0001 depends entirely on module boundaries actually holding over time.
Code review alone does not scale as a guarantee — it's easy for an import of
`modules/media/infrastructure/postgres` from `modules/search` to slip
through, and once one exists, extraction stops being mechanical.

## Decision
`apps/server/architecturetest` statically analyzes the module import graph
(via `go/packages`) and fails if:

- any module imports another module's `domain`, `application`,
  `infrastructure`, `repository`, `transport`, or `events` package directly
  (only `api/` may be imported across module boundaries),
- the resulting module dependency graph doesn't match the edges declared in
  [modules.md](/server/modules) (no undeclared new dependencies, no cycles),
- a module's `domain` package imports its own `infrastructure` (layering
  inversion).

This test runs in CI (`make lint` / a dedicated CI step) and blocks merge on
violation.

## Consequences
- Boundary violations are caught at PR time, not discovered during an
  extraction attempt months later.
- New modules must declare their dependencies in `modules.md` in the same PR,
  keeping the graph documentation and the enforced reality in sync by
  construction.
- Adds a small amount of CI time and one more thing a new module must satisfy;
  accepted because the alternative is architectural erosion that only shows up
  as a costly rewrite at extraction time.
