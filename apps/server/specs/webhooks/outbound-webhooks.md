# Spec: webhooks/outbound-webhooks

Type: Command
Module: webhooks
Status: Implemented

## Context

Third parties must learn about changes (a task completed, a file ready) without polling. The delivery
primitives existed in `internal/platform/webhooks` (signed River job, SSRF-guarded client) but nothing
called them. This module adds the endpoint registry, the fan-out of integration events to endpoints, the
delivery log and an operator API. Wire format: `docs/content/api/webhooks.md`.

## Scenarios

**Happy path**

- Given webhooks are enabled and an operator registered an active endpoint subscribed to `tasks.v1.TaskCompleted`
- When a task is completed
- Then the fan-out consumer writes one `webhooks.deliveries` row and one `platform.webhook_delivery` job in
  one transaction, the worker POSTs the signed payload, and the row becomes `delivered`.

**Edge cases**

- A redelivered event inserts nothing: the row is `UNIQUE (endpoint_id, event_id)` and only inserted rows get a job.
- A receiver that answers a permanent 4xx, or fails all 25 attempts, leaves the row `failed`; after
  `AEDST_WEBHOOKS_DISABLE_AFTER_FAILURES` such deliveries in a row the endpoint is disabled (`consecutive_failures`).
- A disabled or deleted endpoint: queued deliveries are cancelled when next attempted (`cancelled`).
- `CreateEndpoint` retried with the same `Idempotency-Key` returns the first endpoint and the same secret.
- `RedeliverDelivery` on a pending delivery returns it unchanged; on a delivered one it is refused.
- With `AEDST_WEBHOOKS_ENABLED=false` nothing is subscribed, nothing is sent and every RPC is refused.

## Errors

| Condition | `sharederrors.Kind` | `connect.Code` |
| --------- | ------------------- | -------------- |
| Webhooks disabled (`WEBHOOKS_DISABLED`) | FailedPrecondition | `FAILED_PRECONDITION` |
| URL not https, with credentials or a fragment; unknown event type (`UNKNOWN_EVENT_TYPE`) | Validation | `INVALID_ARGUMENT` |
| Unknown endpoint or delivery | NotFound | `NOT_FOUND` |
| Redeliver a delivered delivery (`DELIVERY_ALREADY_DELIVERED`) or of a disabled endpoint (`ENDPOINT_DISABLED`) | FailedPrecondition | `FAILED_PRECONDITION` |
| Idempotency key reused with another request | Conflict | `ABORTED` |
| Caller without the `admin` role | (role policy) | `PERMISSION_DENIED` |

## API

```proto
service WebhooksService {
  rpc CreateEndpoint, GetEndpoint, ListEndpoints, RotateEndpointSecret,
      DisableEndpoint, EnableEndpoint, DeleteEndpoint, ListDeliveries, RedeliverDelivery
}
```

Contract: `api/proto/aedst/webhooks/v1/webhooks.proto`. The signing secret is returned by `CreateEndpoint`
and `RotateEndpointSecret` only.

## Events

Publishes none. Consumes (one `webhooks.fanout_*` consumer each): `tasks.v1.TaskCreated`, `TaskUpdated`,
`TaskCompleted`, `TaskDeleted`, `TaskDueSoon`, `media.v1.MediaReady`, `MediaDeleted`.

## Cross-module dependencies

None synchronous. Event types are imported from `tasks/api` and `media/api`.

## NFR

- Idempotency: `CreateEndpoint` honours `Idempotency-Key`; state transitions are guarded in SQL; the fan-out
  is idempotent on (endpoint, event id).
- Secrets: AES-256-GCM at rest (`AEDST_WEBHOOKS_SECRET_KEY`), never logged, never in job args or errors.
- Timeout: 15 s per delivery attempt.
- Hot path: no (background jobs; the API is operator-only).
- Not verified against PostgreSQL, River or a real receiver (unit tests only).
