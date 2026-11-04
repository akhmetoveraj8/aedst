---
title: "Event Architecture"
description: "Integration events are how a module observes another module's state changes without a synchronous call — see modules.md for which modules are event-only..."
---

# Event Architecture

Integration events are how a module observes another module's state changes
without a synchronous call — see [modules.md](/server/modules) for which modules are
event-only consumers, and [ADR-0014](/decisions/0014-river-insert-tx-as-outbox)
for why the transport is what it is.

```
domain change + events.Publisher.Publish    (one Postgres transaction: the state
        │                                    change and one River job per consumer;
        │                                    river_job IS the outbox)
        ▼
  River fetches the delivery job            (any replica working the queue)
        │
        ▼
  events.Worker -> consumer handler         (looked up by consumer name; at-least-once,
                                             River retries with backoff, then discards)
```

There is one asynchronous mechanism: **River**. A module's own deferred work
(a reminder, an object cleanup) is a job of its own kind
([ADR-0005](/decisions/0005-river-for-jobs)); an event for other modules is a
`platform.event_delivery` job per subscribed consumer, inserted by
`internal/platform/events`. There is no relay, no in-process bus and no inbox
table.

## Producing and consuming

Producer, in the module's repository, inside the transaction that changes state
(`internal/modules/tasks/infrastructure/postgres` is the reference):

```go
err := database.WithTx(ctx, r.pool, func(ctx context.Context, tx pgx.Tx) error {
    // ... guarded UPDATE ...
    _, err := r.events.Publish(ctx, tx, api.TaskCompletedEventType, api.TaskCompletedEventVersion, task.ID, api.TaskCompletedEvent{...})
    return err
})
```

Consumer, in `infrastructure/events` of the consuming module
(`internal/modules/notifications/infrastructure/events` is the reference):

```go
registry.Subscribe(tasksapi.TaskCompletedEventType, "notifications.task_completed",
    func(ctx context.Context, e events.Event) error { /* idempotent effect on the jobs pool */ })
```

`cmd/server` creates the `events.Registry` and the `events.Publisher` (over the
River client), registers the delivery worker in **every** process (River
validates job kinds on insert, and the producing process decides the fan-out),
and passes the registry to each module's `Subscribe`.

## Conventions

- **Type**: `<module>.v<version>.<EventName>`, e.g. `tasks.v1.TaskCompleted`.
- **Contract**: the event type constant and payload struct live in the
  producer's `api/` package (`modules/<module>/api/events.go`) — the only
  package a consumer may import. Payloads are JSON while every consumer is
  in-process; when an event has to cross a service boundary, promote it to a
  protobuf message under `api/proto/aedst/<module>/v1/events.proto` with the
  same field names.
- **Evolution**: within a version fields are only added — consumers ignore
  unknown fields, and nothing is renamed, retyped or removed. A breaking
  change publishes a new version (`…v2`) next to the old one until every
  consumer has moved, then the old one is retired.
- **Self-contained payloads**: an event carries what a consumer needs to build
  its projection (e.g. `TaskCompleted` includes the task title) so consumers
  never call back into the producer. If a consumer would need to, the payload
  is wrong.
- **Identity**: every event has an `event_id` (UUIDv7 minted by `Publish`),
  stable across retries and shared by all of its deliveries. Consumers dedupe on
  it.
- **Consumer names** (`notifications.task_completed`) are stored in the job
  arguments: keep them stable, never rename one while jobs are queued.
- **Delivery**: at-least-once. River retries a failing handler with its default
  backoff (attempt^4 seconds, about 4.3 h in total over 10 attempts), then
  **discards** the job and keeps it for `AEDST_JOBS_DISCARDED_RETENTION_HOURS`
  for inspection and replay. A malformed delivery is cancelled at once. An
  unknown consumer name (this replica is older than the producer) is retried,
  not cancelled. **Handlers must be idempotent** — there is no inbox table: key
  the effect on the event id (a `UNIQUE source_event_id` column, as
  `notifications` does) or make it a version-guarded upsert (as `search` does).
  A handler that writes to the database opens one transaction on the **jobs
  pool** so the effect and any follow-up job commit together.
- **Uniqueness**: `(consumer, event_id)` is unique per delivery job
  (`river:"unique"`), so the same event cannot be queued twice for a consumer.
- **Ordering**: jobs run concurrently and are retried independently; there is
  **no ordering guarantee**. Consumers that care compare a version/timestamp
  carried in the payload; `partition_key` (the aggregate id) is recorded on every
  delivery so a broker with per-key ordering can be introduced later without
  touching producers.
- **Tracing**: the originating W3C `traceparent` is stored in the job arguments
  and restored by the worker, so a consumer's span (`events.deliver <type>`)
  appears in the trace of the request that caused it.
- **No consumer, no job**: an event type nobody subscribed to inserts nothing.

## Operating event delivery

Configuration (see `.env.example`):

| Variable | Default | Meaning |
|---|---|---|
| `AEDST_JOBS_QUEUES` | `default=50,media=2` | Which queues a process works. Deliveries run on `default`. Empty = insert-only (producers still publish). |
| `AEDST_JOBS_COMPLETED_RETENTION_HOURS` | 24 | Completed deliveries are kept this long before River's cleaner deletes them. |
| `AEDST_JOBS_CANCELLED_RETENTION_HOURS` | 24 | Same for cancelled ones. |
| `AEDST_JOBS_DISCARDED_RETENTION_HOURS` | 168 | Discarded deliveries (the dead-letter list) are kept this long. |
| `AEDST_JOBS_POLL_ONLY` | false | River without LISTEN/NOTIFY (transaction-pooled jobs pool without a direct DSN). |

Metrics (OTLP; Prometheus `/metrics` only if enabled, off by default):

| Metric | Alert on |
|---|---|
| `aedst_river_oldest_available_age_seconds` | > 30 s for 5 min (`AedstJobsLagging`) — no worker is fetching, or consumers are slow. |
| `aedst_river_jobs{state}` | `available`+`retryable` rising without bound (`AedstJobsBacklogGrowing`); `discarded` is the dead-letter count. |
| `aedst_events_failed_total{consumer}` | Sustained non-zero rate (`AedstEventDeliveryFailing`) — a handler is failing and being retried. |
| `aedst_events_discarded_total{consumer}` | **Any increase** (`AedstEventDiscarded`) — a delivery was given up on. |
| `aedst_events_delivered_total{consumer}`, `aedst_events_delivery_lag_seconds{consumer}` | Throughput and commit-to-handled latency. |

Any number of replicas may work the queue: River fetches with
`FOR UPDATE SKIP LOCKED`, so no delivery runs on two workers at once, and a
worker that dies mid-job leaves it to be rescued after River's stuck-job
threshold.

Inspecting and replaying a discarded delivery (see also the
[runbook](/server/runbook#aedsteventdiscarded)):

```sql
SELECT id, args->>'consumer' AS consumer, args->>'event_type' AS type, args->>'event_id' AS event_id,
       attempt, finalized_at, errors->-1->>'error' AS last_error
FROM river_job WHERE kind = 'platform.event_delivery' AND state = 'discarded' ORDER BY finalized_at DESC;
```

Replay once the fix is deployed with River's own tooling (`riverui`, or
`client.JobRetry(ctx, id)`), which makes the job `available` again with its
attempts preserved.

## Catalog

| Event | Version | Producer | Payload | Consumers |
|---|---|---|---|---|
| `tasks.v1.TaskCompleted` | 1 | `tasks` (on `CompleteTask`, atomically with the status change) | `api.TaskCompletedEvent`: `task_id`, `user_id`, `title`, `completed_at`, `version` | `notifications.task_completed` (projects a "Task completed" feed entry) |
| `tasks.v1.TaskCreated` / `TaskUpdated` | 1 | `tasks` | `api.TaskSnapshot` (incl. `version`) | `search.task_created`, `search.task_updated` |
| `tasks.v1.TaskDeleted` | 1 | `tasks` | `api.TaskDeletedEvent` (incl. `version`) | `search.task_deleted` (tombstone) |
| `tasks.v1.TaskDueSoon` | 1 | `tasks` (reminder job, once per task and due date) | `api.TaskDueSoonEvent` | `notifications.task_due_soon` |
| `media.v1.MediaReady` | 1 | `media` (processing worker, guarded `processing → ready`) | `api.MediaReadyEvent` | `notifications.media_ready`, `search.media_ready` |
| `media.v1.MediaDeleted` | 1 | `media` | `api.MediaDeletedEvent` | `search.media_deleted` |

A new event adds a row here, its type and payload to the producer's
`api/events.go`, and its consumers in the same PR that introduces it.

## Known limits

- Delivery runs in the same process family as the producer. That is the right
  trade while every consumer is in-process; the day a consumer becomes its own
  service, the broker (NATS JetStream or Kafka) is reached by a **bridge consumer
  delivered by River** (the event is still a `river_job` committed in the
  producer's transaction; the bridge forwards it with the event id as the
  deduplication key and `partition_key` as the ordering key). It is never a second
  write beside the transaction. `events.Publisher` stays the producer-facing
  interface. See [ADR-0014](/decisions/0014-river-insert-tx-as-outbox) and the
  [extraction runbook](/server/runbook-extract-service). NATS is **not** adopted
  before that.
- Deliveries share `river_job` with every other job: its insert/lock/update/delete
  churn is the cost of an event (one row per consumer). River's cleaner bounds the
  table; if event volume ever dominates, give deliveries their own queue and then
  their own River database — not a different mechanism ([scaling](/server/scaling)).
- Retention of other tables: `platform.idempotency_keys`, notifications, audit
  entries, dead sessions and search tombstones are purged by River periodic jobs
  (`internal/platform/retention`, `AEDST_RETENTION_*`). Search tombstones
  (`AEDST_RETENTION_TOMBSTONE_HOURS`) must outlive the retry window above, or a
  late old snapshot could resurrect a deleted document.

## Producing an event exactly once

A state transition that publishes an event must be *guarded in SQL*, not only
checked in Go: `UPDATE … WHERE status <> 'done' RETURNING …` returns no row when
the task is already done (a retry, a double click, two devices), and the
repository then publishes **nothing**. Otherwise the second call would mint a
second `event_id` and every consumer would receive a second delivery that looks
like a new event. `tasks.Repository.Complete` is the reference; its integration
test completes one task from eight goroutines and asserts exactly one delivery.
