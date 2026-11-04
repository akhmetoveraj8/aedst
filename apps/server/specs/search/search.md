# Spec: search/search

Type: Query (+ event projection)
Module: search
Status: Implemented

## Context

Cross-module search over the user's own content. The module owns the
projection `search.documents` (Postgres FTS: `tsvector` with the `simple` configuration,
`websearch_to_tsquery`, `ts_rank_cd`, `ts_headline` with markers U+E000/U+E001;
`pg_trgm` for Suggest) and builds it only from integration events
(`tasks.v1.TaskCreated/TaskUpdated/TaskDeleted`, `media.v1.MediaReady/MediaDeleted`),
never reading other modules' schemas.

## Scenarios

**Happy path**

- Given a task is created/changed
- When the event is delivered
- Then the document is upserted in the handler's transaction (River delivery) if the event version is newer than the stored one.

- Given a request `Search{query}`
- Then only the caller's documents are returned, by descending rank, in keyset pages
  (cursor = (score, id), bound to the query text); `total_estimate` (cap 1000) only on the first page.

**Edge cases**

- Events arrive out of order → the higher version wins; a deletion leaves a tombstone
  (`deleted=true`, version +1), so an old snapshot cannot "resurrect" it; tombstones are cleaned by retention
  after `AEDST_RETENTION_TOMBSTONE_HOURS` (must exceed the delivery retry window).
- A token from another query or garbage → `INVALID_ARGUMENT`.
- An empty or too long query → `INVALID_ARGUMENT`.

## Errors

| Condition | `sharederrors.Kind` | `connect.Code` |
| --------- | ------------------- | -------------- |
| Empty query / prefix, bad page_token | Validation | INVALID_ARGUMENT |
| No identity | Unauthorized | UNAUTHENTICATED |

## API

`aedst.search.v1.SearchService`: `Search`, `Suggest`.

## Events

| Event type | Version | partition_key | Payload | Consumers |
| ---------- | ------- | ------------- | ------- | --------- |
| tasks.v1.TaskCreated / TaskUpdated | 1 | task_id | `TaskSnapshot` (with `version`) | search |
| tasks.v1.TaskDeleted | 1 | task_id | `TaskDeletedEvent` (version = last+1) | search |
| media.v1.MediaReady / MediaDeleted | 1 | media_id | media/api/events.go | search, notifications |

## Cross-module dependencies

Only the event types from `tasks/api` and `media/api`.

## NFR

- Caller-scoped: `owner_id` in every query.
- Indexes: GIN(tsv), GIN(title gin_trgm_ops), (owner_id, updated_at, entity_id).
- Hot path: Search/Suggest (k6 `test/load/api.js`).
