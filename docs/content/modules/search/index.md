---
title: "Search"
description: "The search module: a read-only projection built from events. API, events, storage and clients."
---

# Search

A read-only search projection over the caller's own content. It never reads another module's tables.

Server code: `apps/server/internal/modules/search/` · contract: `apps/server/api/proto/aedst/search/v1/` · [API reference](/modules/search/api) · [OpenAPI 3.1](/openapi/aedst.search.v1.yaml).

## Features

| Feature | What it does |
|---|---|
| (flat, one capability) | `Search` (ranked full text) and `Suggest` (prefix) |

## API

`aedst.search.v1.SearchService` (signed-in user).

## Events

| Direction | Events |
|---|---|
| Publishes | None. |
| Consumes | `tasks.v1.TaskCreated`, `TaskUpdated`, `TaskCompleted`, `TaskDeleted`; `media.v1.MediaReady`, `MediaDeleted` (newest `version` wins). |

## Storage and jobs

- Storage: Schema `search`: `search.documents` (tsvector and `pg_trgm`); optionally a Meilisearch index through `internal/platform/search`.
- River jobs: None of its own (event deliveries are River jobs).

## Clients

Web `app/src/modules/search`, Android `feature/search`, Apple `Features/Search`, Desktop `aedst-feature-search`. Android, Apple and Desktop are frozen ([status](/status)).
