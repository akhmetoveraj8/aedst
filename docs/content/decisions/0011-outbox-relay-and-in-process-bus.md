---
title: "ADR-0011: Batched outbox relay and an in-process bus"
description: "Superseded by ADR-0014 (River InsertTx is the outbox; the relay, bus and inbox described here were removed). Kept for history. It had superseded ADR-0004..."
---

# ADR-0011: Batched outbox relay and an in-process bus

## Status
Superseded by [ADR-0014](/decisions/0014-river-insert-tx-as-outbox) (River `InsertTx` is the outbox; the relay, bus and inbox described here were removed). Kept for history. It had superseded [ADR-0004](/decisions/0004-nats-jetstream) (NATS JetStream
for events) and refines [ADR-0005](/decisions/0005-river-for-jobs).

## Context
[ADR-0004](/decisions/0004-nats-jetstream) chose NATS JetStream as the event
transport. In practice the codebase settled on a Postgres transactional
outbox, an in-process bus and per-consumer inboxes, with no broker: every
consumer lives in the same process as its producer, and running a broker for
that is operational cost with no benefit. The first cut of that pipeline then
enqueued one River job per event, which has two scaling problems:

1. **Write amplification.** Every domain commit inserted an outbox row *and* a
   River job row — twice the write cost on the hottest path, and a burst of
   events became a burst of queue rows, churned (insert, lock, update, delete)
   in the same database as the business data.
2. **No visibility.** Nothing reported how far behind delivery was.

## Decision
- The producer writes **only the outbox row**, in the domain transaction
  (`outbox.Writer`). No queue job per event.
- A **`Relay` per module** drains the outbox in **batches**: it claims up to
  `AEDST_OUTBOX_BATCH_SIZE` rows with `UPDATE … WHERE event_id IN (SELECT …
  FOR UPDATE SKIP LOCKED)`, which also increments `attempts` and sets a lease
  in `next_retry_at`, so any number of replicas can run relays concurrently
  and a crashed relay's rows reappear when the lease expires. Delivered rows
  are marked in one statement per batch; failures back off exponentially and
  are poisoned after 10 attempts; delivered rows are purged after a retention
  window.
- Delivery goes to an in-process `messaging.Bus`; every subscriber is wrapped
  in an `inbox.Consumer` (dedupe + effect in one transaction).
- The relay exports `aedst_outbox_*` metrics (pending, oldest-pending age,
  delivered/failed/poisoned, batch size), and the database pools export
  `aedst_db_pool_*`, so lag and saturation are visible before they are
  incidents.
- Background work runs on its own connection pool
  (`AEDST_DATABASE_JOBS_MAX_CONNS`), separate from the request pool, so a
  burst of events or jobs cannot starve request handlers of connections, and
  vice versa.
- River stays for a module's *own deferred work* (e.g. the due-date reminder).

## Consequences
- Commit cost of an event is one INSERT. Delivery latency is one poll interval
  (default 500 ms) instead of "as soon as a worker picks the job" — acceptable
  for integration events, which are asynchronous by definition.
- `messaging.Publisher` is the seam for a real broker. When a consumer becomes
  its own service, add a JetStream (or Kafka) publisher adapter and pass it to
  the relay; producers, the outbox schema and consumers' inboxes do not change.
  Do not add one before that — see the threshold in
  [ADR-0001](/decisions/0001-modular-monolith).
- There is no cross-relay ordering guarantee (see [events.md](/server/events)).
  Consumers that need order carry a version or timestamp in the payload.
- The poll loop costs an index probe per module per interval when idle. That
  is cheap, but it is the reason the interval is configurable and the
  metrics refresh is rate-limited.
- `pg_notify`-driven wake-up would cut idle latency to near zero; it is not
  needed yet and does not survive transaction-pooling proxies, so it is a
  later optimization, not a default.
