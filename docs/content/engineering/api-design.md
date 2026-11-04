---
title: "API design"
description: "How to design an AEDST API: ConnectRPC and Protobuf contracts, resource modeling, naming, versioning, pagination, partial updates, idempotency, errors, auth, rate limits, streaming and the API lifecycle."
---

# API design

AEDST APIs are **ConnectRPC services defined in Protobuf** ([ADR-0002](/decisions/0002-connectrpc)),
not hand-written REST. The roadmap.sh topics (REST principles, URI design, resource modeling, HATEOAS,
GraphQL, SOAP) are translated below into what they mean for a Protobuf contract. The reference service
is `aedst.tasks.v1.TasksService` (`apps/server/api/proto/aedst/tasks/v1/tasks.proto`): copy its shapes.

Design the contract **first**, in the spec (`write-spec` skill, then the `api-design` skill), before any
handler exists. The `.proto` file is the API documentation: every service, RPC, message and field has a
comment that says what it means, its unit, its bounds and its default.

## Styles and when to use them

| Need | Use | Not |
|---|---|---|
| Request/response from any client | Unary Connect RPC | Plain `net/http` JSON handlers, GraphQL (removed), SOAP |
| Server pushes a sequence (progress, large export) | Server-streaming RPC | Polling a status RPC in a tight loop |
| Another system must learn about a change | Integration event (River `InsertTx`, [events](/server/events)) | A callback RPC into the consumer, a broker |
| A third party must be notified | Webhook delivered by a River job (signed, retried, idempotent) | Synchronous outbound calls in the request |
| Browser to own server | The BFF at `/api/rpc` with the generated Connect client | Raw `fetch` in a module |

Plain HTTP endpoints exist only where a protocol demands one (OIDC callback, health, webhook intake,
metrics). Their errors use `application/problem+json` (RFC 9457 Problem Details), never ad-hoc bodies.

## Resource modeling and naming

- One service per bounded context and module: `aedst.<module>.v1.<Module>Service`. The proto package
  carries the major version.
- RPCs are `VerbNoun`, with standard verbs first: `Get`, `List`, `Create`, `Update`, `Delete`; a custom
  verb only for a real state transition (`CompleteTask`, `ReopenTask`), never `UpdateTaskStatus`.
- Every RPC has its **own** `<Rpc>Request` and `<Rpc>Response` (Buf `STANDARD` lint enforces this), so
  either side can gain fields without touching another RPC.
- Fields are `lower_snake_case`; repeated fields are plural; instants are `google.protobuf.Timestamp`
  named `*_at` (`created_at`, `completed_at`); durations are `google.protobuf.Duration`;
  money is integer minor units plus an ISO 4217 code, never a float.
- Enums: the zero value is `<ENUM>_UNSPECIFIED` and is never a valid business value; clients must
  handle unknown values ([client-recipe](/client-recipe), unknown-enum rule).
- Identifiers are opaque strings (UUIDv7 from `apps/server/internal/shared/ids`), never auto-increment
  integers, and never a personal identifier (email, phone) in an id or path.
- The caller's identity comes from the token, never from a request field: there is no `user_id` in a
  request that acts on "my" data.

## Requests and validation

Every field that has a bound declares it with Protovalidate (`buf.validate`): string `max_len`, list
`max_items`, numeric ranges, `page_size` limits, required fields. Validation also lives in `domain`;
Protovalidate is the first line, not the only one. Requests have a size cap per service
(`modulekit.Mount(..., maxBytes)`).

## Lists: pagination, filtering, sorting, search

- Cursor pagination only: `page_size` (bounded, server default when 0) and opaque `page_token` in,
  `next_page_token` out (empty = last page). Keyset underneath (`apps/server/internal/shared/pagination`);
  never `OFFSET`, never a page number.
- A token is bound to its filters and sort; a token reused with different ones is `INVALID_ARGUMENT`.
- Filters are typed fields (enums, repeated ids, time ranges), not a free-form filter string; sort is an
  enum of the orders that have an index.
- Totals are optional and computed only on the first page (see `ListTasks`), or not at all.

## Writes: partial update, concurrency, idempotency

- Partial update uses `google.protobuf.FieldMask update_mask` plus `optional` fields; no mask means
  "the fields that are set". Never a full replace that wipes fields an older client does not know.
- Optimistic concurrency: resources expose `version`; updates accept `optional expected_version`; a
  stale version is `ABORTED` (`Conflict`).
- Every write a client may retry or queue offline is replay-safe: the `Idempotency-Key` header goes
  through `apps/server/internal/platform/idempotency` in the write's transaction, or the write is
  idempotent by guarded SQL. Same key with a different body is a conflict.
- State transitions are guarded in SQL so a retry publishes nothing twice.

## Errors

Errors are Connect codes chosen from the shared vocabulary ([decisions/cross-cutting](/decisions/cross-cutting)):
`INVALID_ARGUMENT` (bad input, with field violations), `NOT_FOUND` (also for another user's object, so
existence does not leak), `ALREADY_EXISTS`, `ABORTED` (version conflict), `FAILED_PRECONDITION`,
`PERMISSION_DENIED`, `UNAUTHENTICATED`, `RESOURCE_EXHAUSTED` (rate limit, with `Retry-After`),
`UNAVAILABLE` (retryable), `INTERNAL` (generic message only). Return domain errors through
`httpserver.ToConnectError`; never a raw driver error, stack trace or internal path. Machine-readable
details (field violations, `CLIENT_UPGRADE_REQUIRED`) are typed error details, not parsed message text.

## Authentication and authorization

- Authentication is OIDC: the IdP issues tokens, the server is a resource server
  (`httpserver.AuthInterceptor`, jwx). No API keys for end users, no Basic auth, no second token format.
- Authorization has three layers: RBAC per procedure in `AEDST_ROLE_POLICY` (deny by default for
  admin), object-level checks in every query (`WHERE id = $1 AND user_id = $2`), and domain rules.
  ABAC/ReBAC needs come to a decision first, not to handler code.
- Machine-to-machine callers use OIDC client credentials with scopes, rotated by the IdP.

## Traffic control

Every authenticated RPC is rate-limited per user (`AEDST_API_RATE_LIMIT_PER_MINUTE`) and every request
passes load shedding (`AEDST_MAX_IN_FLIGHT`). An expensive RPC gets its own, tighter limit and a
documented cost. Responses are compressed by Connect's gzip negotiation; do not add a second
compression layer.

## Versioning and lifecycle

Compatibility rules are [ADR-0009](/decisions/0009-api-compatibility-and-client-versioning) and are
gated by `buf breaking` (mode `FILE`):

1. **Additive only within `v1`**: new fields, RPCs, enum values. Never renumber, retype or reuse a
   field number; a removed field is `reserved` by number and name.
2. A breaking change is a new package `v2` served **beside** `v1`, with both implemented on one
   application service, until telemetry shows no client on `v1`.
3. Deprecation: mark with `deprecated = true` plus a comment naming the replacement and the earliest
   removal date; clients below the minimum version get `CLIENT_UPGRADE_REQUIRED`.
4. New features that clients must discover are advertised through `GetCapabilities`, not guessed from
   the server version.

## Testing the contract

Unit tests for the domain, integration tests against Postgres for the repository, a handler test for
the error mapping, and the cross-client behaviour scenarios (`scripts/behavior`) for the contract.
The web e2e mock must cover exactly the proto RPCs (contract test, [decisions/web](/decisions/web)).
Load-sensitive RPCs get a k6 scenario ([performance](/engineering/performance)).

## Checklist for a new RPC

- [ ] Own request/response messages, comments on every field, Protovalidate bounds on every input.
- [ ] No caller identity in the request; object-level scoping in SQL; role policy entry if not "any user".
- [ ] List: `page_size`/`page_token`/`next_page_token`, keyset index, typed filters, sort enum.
- [ ] Write: `update_mask`, `expected_version`, idempotency or guarded SQL, event in the same transaction.
- [ ] Errors from the shared vocabulary, no internal detail; `NOT_FOUND` for foreign objects.
- [ ] `buf lint` and `buf breaking` green; generated code regenerated, never edited (`task gen`).
- [ ] Clients updated through the [client recipe](/client-recipe); i18n for every new message.
