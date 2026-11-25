---
title: "Webhooks"
description: "Outbound webhooks: the signed delivery format, retries, idempotency, how a receiver verifies a delivery, how endpoints are managed, and what was verified."
---

# Webhooks

A webhook tells a third party that something changed. AEDST delivers one as a River job per
(endpoint, event), never as a synchronous call inside a request. The format is
[Standard Webhooks](https://www.standardwebhooks.com/), so a receiver verifies with an existing library
in its own language instead of hand-written HMAC code.

## Status (honest)

| Part | State |
|---|---|
| Signed delivery job, retries, cancellation rules | implemented and unit-tested: `apps/server/internal/platform/webhooks` (`DeliveryArgs`, `Worker`) |
| SSRF guard for target URLs | implemented and unit-tested (`NewHTTPClient`, `ValidateURL`, shared `netguard.IsPublic`) |
| Verification helper for receivers | implemented (`webhooks.Verify`); other languages use the Standard Webhooks libraries |
| Endpoint registry (schema `webhooks`, goose migration, sqlc queries; signing secrets encrypted at rest with AES-256-GCM) | implemented and unit-tested: `apps/server/internal/modules/webhooks` |
| Fan-out: one event consumer per offered event type that inserts one delivery row and one job per subscribed endpoint, in one transaction | implemented and unit-tested (`infrastructure/events`) |
| Management API `aedst.webhooks.v1.WebhooksService` (register, rotate secret, disable, enable, delete, list deliveries, redeliver) and configuration | implemented and unit-tested ([module page](/modules/webhooks), [API reference](/modules/webhooks/api)) |
| Delivery log and dead-letter state (an endpoint is disabled after too many failed deliveries in a row) | implemented and unit-tested |
| Wiring in `cmd/server` (module registration, worker, event queue) | done; the module is **off by default** (`AEDST_WEBHOOKS_ENABLED`) |
| A run against PostgreSQL, River and a real receiver | **not done**: integration tests exist and compile, they need Docker or `AEDST_TEST_DATABASE_URL` |

With `AEDST_WEBHOOKS_ENABLED=false` (the default) no webhook is sent and the API answers `FAILED_PRECONDITION`.

## Managing endpoints

Endpoints are registered by operators (role `admin`) through `WebhooksService`. `CreateEndpoint` takes the URL and the
event types to subscribe to and returns the signing secret once; `RotateEndpointSecret` replaces it and returns the new
one once. The secret cannot be read back. Event types on offer: `tasks.v1.TaskCreated`, `tasks.v1.TaskUpdated`,
`tasks.v1.TaskCompleted`, `tasks.v1.TaskDeleted`, `tasks.v1.TaskDueSoon`, `media.v1.MediaReady`, `media.v1.MediaDeleted`.

Every delivery has a row in the delivery log (`ListDeliveries`):

| Status | Meaning |
|---|---|
| `pending` | Queued or being retried |
| `delivered` | The receiver answered `2xx` |
| `failed` | The receiver rejected it for good, or all 25 attempts were used up. Counts towards the endpoint failure counter |
| `cancelled` | Not sent: the endpoint was disabled or deleted, or its URL may not be called |

After `AEDST_WEBHOOKS_DISABLE_AFTER_FAILURES` (default 5) failed deliveries in a row the endpoint is disabled with the
reason `consecutive_failures`; a successful delivery resets the counter. `EnableEndpoint` resumes deliveries (events
published meanwhile are not replayed) and `RedeliverDelivery` queues a failed or cancelled delivery again with the same
`webhook-id`.

## The delivery

```
POST <endpoint URL>
Content-Type: application/json
User-Agent: aedst-webhooks/1
webhook-id: 0192f3c4-7a1e-7b52-9d3e-4c1f8a6b2e10
webhook-timestamp: 1795253400
webhook-signature: v1,K5oZfzN95Z9UVu1EsfQmfVNQhnkZ2pj9o9NDN/H/pI4=
Webhook-Event-Type: tasks.v1.TaskCompleted

{"task_id":"0192f3c4-7a1e-7b52-9d3e-4c1f8a6b2e10","title":"Write the release notes"}
```

| Header | Meaning |
|---|---|
| `webhook-id` | The integration event id. The same on every retry: use it as the idempotency key |
| `webhook-timestamp` | Unix seconds when this attempt was signed. Every attempt is signed again |
| `webhook-signature` | `v1,` + base64 of HMAC-SHA256 over `{webhook-id}.{webhook-timestamp}.{body}` with the endpoint secret. May list several signatures separated by spaces during a secret rotation |
| `Webhook-Event-Type` | The event type, for routing before the body is parsed |

The body is the event payload as JSON, byte for byte what was signed. The secret has the form
`whsec_<base64>` and is shown once when the endpoint is registered.

## What a receiver must do

1. Read the **raw** body. Verify before parsing; a re-serialised body does not verify.
2. Verify the signature and the timestamp with a Standard Webhooks library and the endpoint secret.
   Reject a timestamp more than five minutes from your clock (the replay window).
3. De-duplicate on `webhook-id`: delivery is at least once, so the same id can arrive again.
4. Answer `2xx` quickly (within 15 seconds) and do the work afterwards.

Go:

```go
import "github.com/aedst/server/internal/platform/webhooks" // or the Standard Webhooks Go library directly

func handle(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<20))
	if err != nil || webhooks.Verify(secret, body, r.Header) != nil {
		http.Error(w, "invalid signature", http.StatusUnauthorized)
		return
	}
	// de-duplicate on r.Header.Get("webhook-id"), enqueue, then:
	w.WriteHeader(http.StatusNoContent)
}
```

TypeScript (`standardwebhooks` on npm):

```ts
import { Webhook } from "standardwebhooks";

const payload = new Webhook(secret).verify(rawBody, {
  "webhook-id": headers["webhook-id"],
  "webhook-timestamp": headers["webhook-timestamp"],
  "webhook-signature": headers["webhook-signature"],
});
```

## Retries

| Receiver answers | Result |
|---|---|
| `2xx` | Delivered |
| `408`, `425`, `429`, any `5xx`, a redirect, a timeout or a connection error | Retried with River's exponential backoff (attempt^4 seconds), up to 25 attempts over about three weeks, then discarded |
| Any other `4xx` (including `410 Gone`) | Not retried: the receiver rejected this message for good (delivery log: `failed`) |
| Endpoint deleted or disabled, URL no longer valid | Not sent (delivery log: `cancelled`) |

Redirects are never followed. A delivery is unique on (endpoint, event id), so publishing the same event
twice creates one job.

## Target URL rules (SSRF)

An endpoint URL must be `https`, with a host, without credentials or a fragment. When the socket
connects, after DNS resolution, the address must be a public unicast address: loopback, private
(RFC 1918, unique local), link-local (including the cloud metadata address `169.254.169.254`),
carrier-grade NAT, documentation and multicast ranges are refused, so a host name that resolves or is
re-bound to an internal address cannot be reached. A closed deployment can add a host allowlist. Rules:
[security](/engineering/security).
