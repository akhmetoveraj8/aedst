---
name: api-design
description: Design or change an AEDST API (a ConnectRPC service, RPC, message, field, event or plain HTTP endpoint) contract-first, following docs/content/engineering/api-design.md, before any handler or client code exists. Use when adding or changing anything under apps/server/api/proto, a new integration event, or a webhook.
argument-hint: "<module> <what the API must do>"
---

# api-design

Source of truth: [`docs/content/engineering/api-design.md`](../../../docs/content/engineering/api-design.md)
and [ADR-0009](../../../docs/content/decisions/0009-api-compatibility-and-client-versioning.md). Do not
reproduce them; apply them. Reference contract: `apps/server/api/proto/aedst/tasks/v1/tasks.proto`.

## 1. Choose the shape

Unary RPC, server stream, integration event or webhook (table "Styles" in the page). A plain HTTP
endpoint only where a protocol requires one. If the feature is spec-worthy, the contract goes into the
spec first (`write-spec`) and waits for approval.

## 2. Model the resource

Name the resource and its owner. Write the messages: opaque UUIDv7 `id`, `version`, `*_at` timestamps,
`*_UNSPECIFIED = 0` enums, money as minor units plus currency. No caller identity in requests; no PII in
ids. Every field gets a comment (meaning, unit, bounds, default) and a Protovalidate rule when bounded.

## 3. Write the RPCs

Standard verbs first (`Get`, `List`, `Create`, `Update`, `Delete`), a custom verb only for a state
transition. Own `<Rpc>Request`/`<Rpc>Response` each. Lists: `page_size`/`page_token`/`next_page_token`,
typed filters, sort enum backed by an index. Writes: `update_mask`, `optional expected_version`,
idempotency (`Idempotency-Key` through `internal/platform/idempotency`, or guarded SQL), events in the
same transaction. Errors from the shared vocabulary only.

## 4. Decide access

Public (module `Public` hook, needs a reason), any signed-in user (default), or a role (`AEDST_ROLE_POLICY`
entry). Every query scoped by owner. An expensive RPC states its rate limit and cost.

## 5. Check compatibility

Within `v1`: additive only, removed fields `reserved`. Breaking: new `v2` package beside `v1`. Run
`buf lint` and `buf breaking` (through `task server:lint` and `task server:breaking`, or the commands
`task verify:server` prints), then `task server:gen`. Never edit generated code.

## 6. Plan the clients and tests

List the client changes per platform ([client-recipe](../../../docs/content/client-recipe.md)), the
i18n keys for new errors, the behaviour scenarios, the integration tests (replay test for queued
writes), and a k6 scenario when the RPC is on a hot path.

## Output

The `.proto` diff (or the spec section), then the checklist "Checklist for a new RPC" from the page with
every box marked done, not applicable (with a reason), or open.
