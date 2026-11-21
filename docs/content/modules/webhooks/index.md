---
title: "Webhooks"
description: "The webhooks module: endpoint registry, fan-out of events to third-party endpoints, delivery log and the operator API. API, events, storage and jobs."
---

# Webhooks

Outbound webhooks: the endpoints of third parties, the fan-out of integration events to them and the log of what was delivered. It is a consumer: no module calls it synchronously. The wire format a receiver sees is described in [Webhooks](/api/webhooks).

Server code: `apps/server/internal/modules/webhooks/` (delivery job, signer and SSRF-guarded client: `apps/server/internal/platform/webhooks/`) · contract: `apps/server/api/proto/aedst/webhooks/v1/` · [API reference](/modules/webhooks/api) · [OpenAPI 3.1](/openapi/aedst.webhooks.v1.yaml).

Off by default. Without `AEDST_WEBHOOKS_ENABLED` every RPC answers `FAILED_PRECONDITION` (`WEBHOOKS_DISABLED`), no event is fanned out and nothing is sent.

## Features

| Feature | What it does |
|---|---|
| (flat, one capability) | Endpoint registry (`CreateEndpoint`, `GetEndpoint`, `ListEndpoints`, `RotateEndpointSecret`, `DisableEndpoint`, `EnableEndpoint`, `DeleteEndpoint`), delivery log (`ListDeliveries`, `RedeliverDelivery`), fan-out consumer, delivery worker |

## API

`aedst.webhooks.v1.WebhooksService` (operators: role `admin` by default, the module's built-in role policy; `AEDST_ROLE_POLICY` can replace it).

- The signing secret (`whsec_<base64>`) is returned by `CreateEndpoint` and `RotateEndpointSecret` only. No other response carries it and it cannot be read back.
- `CreateEndpoint` is replay-safe with an `Idempotency-Key` header: a retry returns the same endpoint and secret.
- `DisableEndpoint`, `EnableEndpoint` and `RedeliverDelivery` are guarded transitions: repeating one changes nothing.
- Lists use keyset pagination (`page_size` up to 100, `page_token`, `next_page_token`), newest first.
- `RedeliverDelivery` has its own per-user limit (60 per minute, `AEDST_PROCEDURE_RATE_LIMITS`).

## Events

| Direction | Events |
|---|---|
| Publishes | None. |
| Consumes | `tasks.v1.TaskCreated`, `tasks.v1.TaskUpdated`, `tasks.v1.TaskCompleted`, `tasks.v1.TaskDeleted`, `tasks.v1.TaskDueSoon`, `media.v1.MediaReady`, `media.v1.MediaDeleted` (one `webhooks.fanout_*` consumer each, idempotent on endpoint and event id). |

These are the event types an endpoint may subscribe to. The fan-out forwards the payload as published and never decodes it. Offering another event is one line in the module's `Consumes` and one `Subscribe` call.

## Storage and jobs

- Storage: Schema `webhooks`: `webhooks.endpoints` (URL, subscribed event types, status, failure counter, the signing secret encrypted with AES-256-GCM), `webhooks.deliveries` (one row per endpoint and event, `UNIQUE (endpoint_id, event_id)`; status `pending`, `delivered`, `failed` or `cancelled`, attempts, last status code and error).
- River jobs: `platform.event_delivery` on queue `events_webhooks` (the fan-out), `platform.webhook_delivery` on queue `default` (one signed POST per endpoint and event, up to 25 attempts).
- Retention: `webhooks.deliveries` rows are purged after `AEDST_WEBHOOKS_DELIVERY_RETENTION_DAYS` (30).
- Dead-letter state: after `AEDST_WEBHOOKS_DISABLE_AFTER_FAILURES` (5) failed deliveries in a row an endpoint is disabled with the reason `consecutive_failures`; a success resets the counter. `EnableEndpoint` resumes it and `RedeliverDelivery` queues a failed delivery again.

## Configuration

| Variable | Meaning |
|---|---|
| `AEDST_WEBHOOKS_ENABLED` | Turns the module on (default `false`) |
| `AEDST_WEBHOOKS_SECRET_KEY` | Required when enabled: 32 random bytes in base64 (`openssl rand -base64 32`), optionally `<version>:<base64>`; seals endpoint secrets at rest |
| `AEDST_WEBHOOKS_PREVIOUS_SECRET_KEYS` | Older keys as `<version>:<base64>`, comma separated, kept to open secrets sealed before a key rotation |
| `AEDST_WEBHOOKS_ALLOWED_HOSTS` | Optional host allowlist for deliveries |
| `AEDST_WEBHOOKS_DISABLE_AFTER_FAILURES` | Failed deliveries in a row before an endpoint is disabled (default 5) |
| `AEDST_WEBHOOKS_DELIVERY_RETENTION_DAYS` | Delivery log retention in days (default 30) |

Rotating the sealing key: set the new key with the next version in `AEDST_WEBHOOKS_SECRET_KEY` and move the old one to `AEDST_WEBHOOKS_PREVIOUS_SECRET_KEYS`. Existing endpoints keep working; a row is sealed with the new key when its secret is next rotated.

## Clients

None. The module is server-only: operators call the API directly (no admin screen yet).

## Verification

Unit tests cover the domain, the use cases, the error mapping, the fan-out handler, the encryption and the worker's outcome recording. The module was not run against PostgreSQL, River or a real receiver; its integration tests compile and need Docker or `AEDST_TEST_DATABASE_URL`.

## See also

Wire format and receiver guide: [Webhooks](/api/webhooks). Decisions: [server decisions](/decisions/server) (Standard Webhooks, encryption at rest). SSRF rules: [security](/engineering/security).
