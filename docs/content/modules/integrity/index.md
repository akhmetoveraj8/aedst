---
title: "Play Integrity"
description: "The integrity module: Google Play Integrity token verification. API, storage and clients."
---

# Play Integrity

Verification of Google Play Integrity standard tokens and the server-side policy (package, freshness, request binding, verdicts, replay).

Server code: `apps/server/internal/modules/integrity/` · contract: `apps/server/api/proto/aedst/integrity/v1/` · [API reference](/modules/integrity/api) · [OpenAPI 3.1](/openapi/aedst.integrity.v1.yaml).

## Features

| Feature | What it does |
|---|---|
| (flat, one capability) | `VerifyIntegrityToken` |

## API

`aedst.integrity.v1.IntegrityService` (signed-in Android app; `FAILED_PRECONDITION` until `AEDST_INTEGRITY_ENABLED=true`).

## Events

| Direction | Events |
|---|---|
| Publishes | None. |
| Consumes | None. |

## Storage and jobs

- Storage: Schema `integrity`: `integrity.verified_tokens` (replay table, insert only, purged by retention).
- River jobs: None.

## Clients

Android only (`core/security`).. Android, Apple and Desktop are frozen ([status](/status)).

## See also

Decision: [ADR-0016](/decisions/0016-device-attestation).
