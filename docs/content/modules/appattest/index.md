---
title: "App Attest"
description: "The appattest module: Apple App Attest enrolment and assertions. API, storage and clients."
---

# App Attest

Apple App Attest: challenges, key enrolment and assertion verification.

Server code: `apps/server/internal/modules/appattest/` · contract: `apps/server/api/proto/aedst/appattest/v1/` · [API reference](/modules/appattest/api) · [OpenAPI 3.1](/openapi/aedst.appattest.v1.yaml).

## Features

| Feature | What it does |
|---|---|
| (flat, one capability) | `CreateChallenge`, `Enroll`, `VerifyAssertion` |

## API

`aedst.appattest.v1.AppAttestService` (signed-in Apple app). Its RPCs have their own rate limit through `AEDST_PROCEDURE_RATE_LIMITS`.

## Events

| Direction | Events |
|---|---|
| Publishes | None. |
| Consumes | None. |

## Storage and jobs

- Storage: Schema `appattest`: `appattest.challenges`, `appattest.keys`.
- River jobs: None.

## Clients

Apple only.. Android, Apple and Desktop are frozen ([status](/status)).

## See also

Decision: [ADR-0016](/decisions/0016-device-attestation); review notes: [App Attest security review](/server/appattest-security-review).
