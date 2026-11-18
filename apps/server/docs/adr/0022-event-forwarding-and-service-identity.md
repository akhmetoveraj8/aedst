# ADR-0022: Event forwarding across databases, per-database River clients and a service identity

Status: Accepted (2026-11-18). Completes the items [ADR-0020](0020-location-transparent-units.md) left "not built": service-to-service identity (section 5), events across a database (section 6) and the machine identity that blocked admin's remote mutations (section 7). Refines [ADR-0014](../../../../docs/content/decisions/0014-river-insert-tx-as-outbox.md).

## Context

A unit could already run as its own process (`AEDST_MODULES`, `AEDST_MODULE_<NAME>_URL`) and on its own database (`PoolFor`), but four things stopped a *producer* with its own database from really moving:

1. `tasks`, `notifications`, `media` and `admin` used `env.Pool` and `env.Jobs`, so a transaction opened on a module database inserted its jobs and events in the shared River client's tables, or the module's `river_job` rows were never worked.
2. An event whose consumer lives in another service with another database had no path: the delivery job sits in the producer's database, where the consumer's process never looks.
3. A background job (`admin.apply`) had no token, so it could not call another unit synchronously.
4. `media` had no `Remote` hook, so admin's overview omitted it whenever media ran elsewhere.

## Decision

### 1. Service identity: an OIDC client-credentials client

`internal/platform/serviceauth` (the only importer of `golang.org/x/oauth2`) turns `AEDST_SERVICE_IDENTITY_TOKEN_URL`, `_CLIENT_ID`, `_CLIENT_SECRET` and `_SCOPES` into a cached token source. The identity provider grants that client the `internal` role; the receiving unit verifies the token like any other (role policy `internal` on the operator services, already in place). With no token URL the process has no identity and behaves as before: a remote operator mutation is refused up front, reads still forward the operator's own token. Nothing is minted by the server: it stays a pure resource server (ADR-0019) and is a client of the IdP only for these calls.

### 2. Per-database River clients

`Env.JobsFor(module)` and `Env.PublisherFor(module)` return the River client and publisher of the module's own database (the shared ones when it has none). `cmd/server` builds one extra River client per module that has its own jobs pool (same workers and worked queues, no periodic jobs, River schema migrated or verified in that database) and starts and stops it with the shared one. Modules `tasks`, `notifications`, `media` and `admin` now use `PoolFor`, `JobsPoolFor`, `JobsFor` and `PublisherFor` only. The transaction an event or reminder is inserted in is therefore always the one that holds the row.

### 3. Event forwarding

A consumer that lives in another service with its own database is listed in `AEDST_EVENTS_FORWARD` (`unit=URL,...`). `Registry.SubscribeForwarded` catalogues it, and `RiverPublisher.Publish` inserts a `platform.event_forward` job (queue `events_forward`, unique by consumer and event id) instead of a delivery, in the same transaction as the state change: River stays the outbox, there is no dual write. The forward worker calls the consumer service's `aedst.events.v1.EventIngestService/Deliver` (`api/proto/aedst/events/v1/events.proto`, JSON payload as bytes so the golden fixtures keep pinning the payload) with the service identity's token. The consumer service (`AEDST_EVENTS_INGEST_ENABLED=true`, role `internal` only) inserts the real delivery job in its own database, unique on (consumer, event id), so a producer retry after a lost response creates nothing twice. Permanent answers (`NotFound`, `Validation`, `Forbidden`) cancel the forward visibly; everything else retries with River's backoff and is discarded after ten attempts. Metrics: `aedst_events_forwarded_total`, `aedst_events_forward_failed_total`, `aedst_events_forward_discarded_total`. No broker was added.

### 4. Admin across databases

When a unit is hosted in this process but on another database than `admin`, no transaction can span the audit row and the unit's rows. Admin then takes the audit-first path through the unit's in-process operator API (the same `admin.apply` job), exactly as for a unit hosted elsewhere. The single-transaction path remains for units on admin's own database.

### 5. `media` is reachable over the network

`MediaOperatorService.GetTotals` (read-only; roles `admin`, `support`, `auditor`, `internal`) and a `Remote` hook that provides `media/api.Stats` over it, so admin's overview works with `AEDST_MODULE_MEDIA_URL`.

## Consequences

- Moving a producer to its own database or service is configuration: its pools, River client, publisher and migrations (including the `platform` and River schemas) go with it; consumers elsewhere are named in `AEDST_EVENTS_FORWARD`.
- A forwarded event is delivered at least once and consumers are already idempotent (ADR-0014); ordering across the two hops is not guaranteed, as before.
- One more River client per extracted database: connections grow by `JOBS_MAX_CONNS` per such database (the capacity arithmetic in the scaling guide applies per database).
- The ingest endpoint is a new internal surface: closed by role and by default (`AEDST_EVENTS_INGEST_ENABLED=false`).
- **Verified:** unit tests (publisher routing, forward worker classification, ingest end to end over Connect with protovalidate and bearer forwarding, token caching, config validation, media remote contract), `architecturetest`, `golangci-lint`, `go vet` with the `integration` tag. **UNVERIFIED:** nothing here ran against Postgres, River's tables or a real IdP (no Docker on the authoring machine): the per-database River clients, the audit-first path across databases and `Deliver` into a real `river_job` need `task check:full`, and a ZITADEL machine user with the `internal` role must be created and its token accepted by this server.

## Revisit when

A second non-Go consumer of events appears (promote the JSON payload to a Protobuf contract per producer), forwarding latency matters more than operating a second hop (put a broker behind `events.Publisher` as ADR-0014 describes), or the number of databases makes one River client each too costly (move the extracted unit to its own process instead).
