---
title: "ADR-0005: River for background jobs"
description: "Accepted"
---

# ADR-0005: River for background jobs

## Status
Accepted

## Context
Background work (email, push notifications, media processing, search
indexing, cleanup, scheduled tasks) needs reliable, transactional job
scheduling that doesn't require operating a second piece of broker
infrastructure beyond what's already required.

## Decision
Use River, which stores jobs in the same PostgreSQL cluster already used as the
system of record. Jobs can be enqueued in the same transaction as the state
change that triggers them, giving exactly the "committed implies scheduled"
guarantee events would otherwise need an outbox for.

## Consequences
- No separate job-queue infrastructure (e.g. Redis-backed queues) to operate.
- Since [ADR-0014](/decisions/0014-river-insert-tx-as-outbox) River also carries
  cross-module integration events: the producer inserts one delivery job per
  subscribed consumer in its own transaction (`internal/platform/events`), so
  River is the outbox and there is no relay, in-process bus or inbox. A module's
  own deferred work (a reminder, an object cleanup) stays a plain job of its own
  kind; fan-out to other modules goes through `events.Publisher`, never by
  inserting another module's job.
- Job throughput is bounded by the same Postgres cluster serving transactional
  reads/writes; acceptable at current scale, revisit only if a specific job
  type's volume threatens the primary workload — at which point that job type
  moves to its own River queue/database, not a different job system.
