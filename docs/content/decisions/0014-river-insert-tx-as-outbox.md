---
title: "ADR-0014: River InsertTx is the outbox"
description: "Accepted. Supersedes ADR-0011 (batched outbox relay and in-process bus) and the outbox and inbox parts of ADR-0012 (the idempotency table stays). Builds on..."
---

# ADR-0014: River InsertTx is the outbox

## Status
Accepted. Supersedes [ADR-0011](/decisions/0011-outbox-relay-and-in-process-bus)
(batched outbox relay and in-process bus) and the outbox and inbox parts of
[ADR-0012](/decisions/0012-shared-platform-messaging-tables) (the idempotency
table stays). Builds on [ADR-0005](/decisions/0005-river-for-jobs): River is now
the only asynchronous mechanism, for deferred work and for integration events.

## Context
ADR-0011 settled on a hand-built chain: a `platform.outbox` row written in the
domain transaction, a per-module `Relay` that leases rows with
`FOR UPDATE SKIP LOCKED`, an in-process `messaging.Bus`, and a
`platform.inbox` marker per consumer written in the consumer's transaction. It
worked, but it duplicated what River already provides and what we already
operate:

- River's `InsertTx` inserts a job in the caller's `pgx.Tx`, so "committed
  implies scheduled" is already guaranteed. That is the transactional outbox.
- River already has leases (job fetching with `SKIP LOCKED`), retries with
  backoff, a bounded number of attempts, a discarded state that keeps the
  failed job for inspection, a cleaner for finished jobs, unique jobs, leader
  election and OpenTelemetry-friendly hooks. The relay, its poison handling,
  its purge, its lag metrics and the inbox table re-implemented each of these.
- ADR-0011 rejected one River job per event for write amplification (outbox row
  plus job row) and missing visibility. With River as the outbox there is one
  row per delivery, not two, and `river_job` states are the visibility.

The owner reviewed the trade-off and decided: the monolith scheme is right,
River is the transport, and a broker is introduced only when a consumer
becomes a separate service.

## Decision
- **`internal/platform/events`** is the seam. A producer calls
  `Publisher.Publish(ctx, tx, eventType, version, partitionKey, payload)` inside
  its own transaction (the repository's `database.WithTx`). Publish marshals the
  payload to JSON, mints the event id (UUIDv7), captures the W3C `traceparent`
  and inserts **one River job per subscribed consumer** with
  `InsertManyTx` on that `tx`. An event with no consumer writes nothing.
- **Consumers** register in a `Registry`
  (`registry.Subscribe(eventType, consumerName, handler)`); modules do this from
  `infrastructure/events` in `cmd/server`. A single River worker
  (`platform.event_delivery` jobs, `events.Worker`) looks the consumer up by
  name and runs the handler, restoring the `traceparent` and recording a span.
- **At-least-once, idempotent handlers.** There is no inbox table. A handler
  must tolerate redelivery, normally with a natural key on the event id
  (`notifications.notifications.source_event_id` is `UNIQUE`) or a version-guarded
  upsert (the search projection). River retries a failing handler with its
  default backoff for 10 attempts (`MaxAttempts`), then discards the job; a
  malformed delivery is cancelled immediately; an unknown consumer (a replica
  older than the producer) is retried, not cancelled.
- **Uniqueness.** `DeliveryArgs` is unique by `(consumer, event_id)` through
  `river:"unique"` tags and `UniqueOpts{ByArgs: true}`, so the same event cannot
  be queued twice for one consumer.
- **Retention is River's.** `river.Config.CompletedJobRetentionPeriod`,
  `CancelledJobRetentionPeriod` and `DiscardedJobRetentionPeriod` are configured
  from `AEDST_JOBS_{COMPLETED,CANCELLED,DISCARDED}_RETENTION_HOURS`
  (24/24/168). Discarded jobs are the dead-letter list. The search tombstone
  retention is now `AEDST_RETENTION_TOMBSTONE_HOURS`.
- **Observability.** `aedst_events_{delivered,failed,discarded}_total{consumer}`
  and `aedst_events_delivery_lag_seconds` come from the worker;
  `aedst_river_jobs{state}` and `aedst_river_oldest_available_age_seconds` come
  from `platform/jobs`. The admin overview's `outbox_lag_seconds` field (name
  kept for wire compatibility) is the oldest ready River job. Alerts:
  `AedstJobsLagging`, `AedstJobsBacklogGrowing`, `AedstEventDeliveryFailing`,
  `AedstEventDiscarded`.
- **Removed:** `internal/platform/{outbox,inbox,messaging}`, the relay and its
  configuration (`AEDST_OUTBOX_*`, `AEDST_RETENTION_INBOX_HOURS`), the
  `platform.outbox` and `platform.inbox` tables (migration
  `migrations/platform/00002_drop_outbox_inbox.sql`, forward-only; it refuses to
  run while the outbox still holds undelivered events, so drain the previous
  release first).
- **Pools.** `InsertManyTx` runs on the producer's transaction, i.e. the API
  pool, which may sit behind PgBouncer in transaction mode (an insert is plain
  SQL plus a trigger-driven `pg_notify`, both transaction-scoped). River's
  fetchers, the listener and the handlers run on the jobs pool (direct DSN or
  `AEDST_JOBS_POLL_ONLY`), unchanged.

## Consequences
- One mechanism instead of five (`outbox`, relay, bus, inbox, retention
  policies for them). Commit cost of an event is one `river_job` INSERT per
  consumer. Delivery latency is River's fetch path (LISTEN/NOTIFY wake-up, or
  the poll interval with `PollOnly`), typically lower than the old 500 ms poll.
- Each consumer has an independent retry, backoff and dead-letter lifecycle
  instead of one failing subscriber re-running its siblings through the bus.
- Exactly-once *effect* is no longer provided by a framework table: every
  handler is responsible for idempotency. The reference handlers are
  `modules/notifications/infrastructure/events` and
  `modules/search/infrastructure/events`. A SQL-guarded producer transition
  (`UPDATE … WHERE status <> 'done' RETURNING …`) is still mandatory so that a
  retried command does not mint a second `event_id`.
- Event rows and job rows now share `river_job`'s churn (insert, lock, update,
  delete). The cleaner and the partial indexes keep it bounded; the old
  per-module claim index and the shared outbox table are gone.
- No cross-job ordering guarantee (as before). Consumers that care compare a
  version or timestamp carried in the payload; `partition_key` stays on the job
  so a broker with per-key ordering can be added later.
- Producers and consumers are decoupled from River by the `events` package:
  `events.Publisher` is an interface (`RiverPublisher` is the only implementation)
  and **the seam for a broker**. The day a consumer becomes a separate service,
  the bridge to a broker (NATS JetStream or Kafka) is itself a **River-delivered
  consumer**: the producer still commits the event as a River job in its own
  transaction, and a bridge consumer (a subscription of the `platform.event_forward`
  job kind) forwards it to the broker with at-least-once retries and the event id
  as the broker's deduplication key. There is never a second write beside the
  transaction (no dual write), so `river_job` stays the outbox. Producers, event
  contracts and handlers do not change. **NATS is not adopted now.** See
  [ADR-0001](/decisions/0001-modular-monolith) for the extraction threshold.

## Revisit when
A consumer becomes its own service (add the broker adapter), or measured
`river_job` churn from event deliveries threatens the primary workload (give
events their own River queue and then their own database, not a different
mechanism; see [scaling](/server/scaling)).
