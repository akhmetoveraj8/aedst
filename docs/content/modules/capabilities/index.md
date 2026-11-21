---
title: "Capabilities"
description: "The capabilities module: public capability negotiation. API, caching and clients."
---

# Capabilities

Capability negotiation: the server identity, the supported client releases and the enabled features. Stateless and public.

Server code: `apps/server/internal/modules/capabilities/` · contract: `apps/server/api/proto/aedst/capabilities/v1/` · [API reference](/modules/capabilities/api) · [OpenAPI 3.1](/openapi/aedst.capabilities.v1.yaml).

## Features

| Feature | What it does |
|---|---|
| (flat, one capability) | `GetCapabilities` |

## API

`aedst.capabilities.v1.CapabilitiesService` (public, no token). `GetCapabilities` has no side effects, so it is also a Connect `GET` with `ETag` and `Cache-Control` ([conditional reads](/engineering/api-design#conditional-reads-and-caching)).

## Events

| Direction | Events |
|---|---|
| Publishes | None. |
| Consumes | None. |

## Storage and jobs

- Storage: None (configuration only).
- River jobs: None.

## Clients

Every client calls it at start-up and on resume (Web `shared`, Android and Apple core, Desktop `aedst-capabilities`).. Android, Apple and Desktop are frozen ([status](/status)).

## See also

Version gate: [ADR-0009](/decisions/0009-api-compatibility-and-client-versioning).
