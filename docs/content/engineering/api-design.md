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
| A third party must be notified | Webhook delivered by a River job (`internal/platform/webhooks`: Standard Webhooks signature, retried, idempotent on the event id; [format](/api/webhooks); endpoints are registered through `WebhooksService`, [module](/modules/webhooks)) | Synchronous outbound calls in the request, hand-written HMAC |
| Browser to own server | The BFF at `/api/rpc` with the generated Connect client | Raw `fetch` in a module |

Plain HTTP endpoints exist only where a protocol demands one (OIDC callback, health, webhook intake,
metrics). Their errors use `application/problem+json` (RFC 9457 Problem Details), never ad-hoc bodies:
call `httpserver.WriteProblem(w, r, httpserver.Problem{Status, Code, Detail})`, the only place that
writes one (members `type`, `title`, `status`, `detail`, `instance`, extension `code` in
`UPPER_SNAKE_CASE`). The router already answers its own failures this way: 404 and 405, 413 body too
large, 429 load shedding, 500 after a panic, 504 timeout, 503 from `/readyz`. Never `http.Error`.

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
`httpserver.ToConnectError`; never a raw driver error, stack trace or internal path.

Machine-readable details are typed `google.rpc` error details (`errdetails`), never parsed message
text. `ToConnectError` and the interceptors attach them; clients switch on `ErrorInfo.reason`:

| Case | Code | Details |
|---|---|---|
| Any classified domain error | by kind | `ErrorInfo{reason, domain: "aedst"}`; the reason defaults to the kind (`NOT_FOUND`, `ALREADY_EXISTS`, `INVALID_ARGUMENT`, ...) and is made specific with `sharederrors.X(...).WithReason("STALE_VERSION")` |
| Request validation (Protovalidate) | `INVALID_ARGUMENT` | `buf.validate.Violations` (field path, rule, message) |
| Stale `expected_version`, reused or in-flight idempotency key | `ABORTED` | `ErrorInfo` (`STALE_VERSION`, `IDEMPOTENCY_KEY_REUSED`, `IDEMPOTENCY_KEY_IN_PROGRESS`) and `PreconditionFailure{violations[type = reason]}` |
| State does not allow the call | `FAILED_PRECONDITION` | `ErrorInfo` and `PreconditionFailure`; `CLIENT_UPGRADE_REQUIRED` carries `platform`, `client_version`, `minimum_version` metadata |
| Rate limit (per user, per procedure, per address, failed sign-ins) | `RESOURCE_EXHAUSTED` | `ErrorInfo{RATE_LIMITED}`, `RetryInfo{retry_delay}` and the `Retry-After` header |
| Dependency down | `UNAVAILABLE` | `ErrorInfo{UNAVAILABLE}`, `RetryInfo` (5 s) and `Retry-After` |
| Missing role or scope | `PERMISSION_DENIED` | `ErrorInfo{PERMISSION_DENIED}` or `ErrorInfo{INSUFFICIENT_SCOPE, metadata.required_scopes}` |
| Outbound webhooks ([module](/modules/webhooks)) | `FAILED_PRECONDITION`, `INVALID_ARGUMENT` | `ErrorInfo`: `WEBHOOKS_DISABLED` (the server runs without `AEDST_WEBHOOKS_ENABLED`), `ENDPOINT_DISABLED` and `DELIVERY_ALREADY_DELIVERED` (`RedeliverDelivery`), `UNKNOWN_EVENT_TYPE` (`CreateEndpoint`) |
| Bug | `INTERNAL` | none, generic message |

A new reason is `UPPER_SNAKE_CASE`, stable once shipped, and added to this table. Gate:
`TestToConnectError_TypedDetailsOnTheWire` (`internal/platform/httpserver`).

## Authentication and authorization

- Authentication is OIDC: the IdP issues tokens, the server is a resource server
  (`httpserver.AuthInterceptor`, jwx). No API keys for end users, no Basic auth, no second token format.
- Authorization has three layers: RBAC per procedure in `AEDST_ROLE_POLICY` (deny by default for
  admin), object-level checks in every query (`WHERE id = $1 AND user_id = $2`), and domain rules.
  ABAC/ReBAC needs come to a decision first, not to handler code.
- Machine-to-machine callers use OIDC client credentials with scopes, rotated by the IdP. The verified
  token's `scope` / `scp` claims are on `auth.Identity.Scopes`, and the same policy requires them: an
  alternative is a role, `scope:<name>` or both joined with `+`, for example
  `/aedst.tasks.v1.TasksOperatorService/*=admin|support|scope:tasks.operator` (people by role, machines by
  scope) or `/aedst.events.v1.EventIngestService/*=internal+scope:events.ingest` (the service identity of
  ADR-0022 must hold the role and the scope it requested with `AEDST_SERVICE_IDENTITY_SCOPES`). A
  malformed entry fails startup; a denial that a scope would have opened answers `INSUFFICIENT_SCOPE`.
  Never check a scope or a role in handler code.

## Traffic control

Every authenticated RPC is rate-limited per user (`AEDST_API_RATE_LIMIT_PER_MINUTE`) and every request
passes load shedding (`AEDST_MAX_IN_FLIGHT`). An expensive RPC gets its own, tighter per-user limit as
**configuration**, never as module code: a built-in default in the module registration
(`modulekit.Module.RateLimits`, returning `httpserver.ProcedureLimit{PerMinute, Bucket}` per procedure;
procedures with one `Bucket` share a budget) and a deployment override in
`AEDST_PROCEDURE_RATE_LIMITS=/pkg.Service/Method=10,/pkg.Service/*=60` (0 switches a default off; an
unknown or public procedure fails startup). `httpserver.ProcedureRateLimitInterceptor` enforces it
after authentication and, like every limiter, degrades to per-replica limits when DragonflyDB is down. Reference: `appattest` (enrolment 10 per
minute, assertions 120) and `integrity` (10 per minute). Do not inject a limiter into an application
service. Helm: `config.procedureRateLimits`. Responses are compressed by Connect's gzip negotiation; do not add a second
compression layer.

## Conditional reads and caching

Every response is `Cache-Control: no-store` unless the read is marked. A read that is the same for many
callers and changes rarely is made a conditional GET, declaratively:

1. Declare the RPC `option idempotency_level = NO_SIDE_EFFECTS;` in the `.proto`. Connect then also
   serves it as `GET /pkg.Service/Method?connect=v1&encoding=json&message=...` (POST keeps working).
2. List it in the module registration: `Cacheable: map[string]httpserver.CachePolicy{procedure: {MaxAge,
   Shared, Vary}}` (`modulekit.Module`). Startup fails when the procedure is unknown, is not
   `NO_SIDE_EFFECTS`, has no `MaxAge`, or asks for a shared (`public`) cache without being a public
   procedure: a per-user answer is `private` at most.

`httpserver.ConditionalReadInterceptor` (outermost in the chain, so auth and limits still run) then
answers a successful GET with a strong `ETag` (SHA-256 of the deterministic encoding of the response
and of its representation), `Cache-Control: public|private, max-age=N` and `Vary`; a request whose
`If-None-Match` matches gets `304` with no body through Connect's own not-modified signal. Errors and
POST calls stay `no-store`. Reference: `CapabilitiesService.GetCapabilities` (public, five minutes,
`Vary: X-Aedst-Client`). Never hand-write ETag or 304 handling in a handler; a plain HTTP GET that
serves bytes uses `http.ServeContent` with an `ETag` header. Changing the idempotency level of a
shipped RPC is reported by `buf breaking` and needs a scoped `ignore_only` with the reason.

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

## Event contracts

An integration event's payload is a Protobuf message in `api/proto/aedst/<module>/events/v1/events.proto`
(package `aedst.<module>.events.v1`), one message per payload, so `buf breaking` covers it. On the wire it
is JSON with the proto field names (`task_id`), timestamps as RFC 3339, pinned by the golden fixtures
(`<module>/api/testdata/<Event>.v<N>.json`). The Go payload struct in `<module>/api/events.go` mirrors the
message field for field; copy `internal/modules/tasks/api/events_contract_test.go`, which fails when the
struct, the fixture and the message disagree. Add a field to the message, the struct and the fixture in
one change; a breaking change is a new event version and a new package version. Reference: `tasks`
([generated page](/modules/tasks/events)).

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
