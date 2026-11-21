---
title: "Media"
description: "The media module: direct-to-storage uploads, processing jobs, variants, events, storage and clients."
---

# Media

Uploaded files. Bytes never pass through the API: the client gets a presigned URL, uploads to object storage and confirms; a job verifies and sanitises the object.

Server code: `apps/server/internal/modules/media/` · contract: `apps/server/api/proto/aedst/media/v1/` · [API reference](/modules/media/api) · [OpenAPI 3.1](/openapi/aedst.media.v1.yaml).

## Features

| Feature | What it does |
|---|---|
| (flat, one capability) | Upload, confirm, read, list, delete; image sanitising (govips) and video posters; imgproxy variants |

## API

`aedst.media.v1.MediaService` (signed-in user) and `aedst.media.v1.MediaOperatorService` (staff and machine identity).

## Events

| Direction | Events |
|---|---|
| Publishes | `media.v1.MediaReady`, `media.v1.MediaDeleted`. |
| Consumes | None. It calls the `tasks` module's `api/` package to check that an attachment's task belongs to the caller. |

## Storage and jobs

- Storage: Schema `media`: `media.media`, `media.variants`; objects in S3, MinIO or R2 through `internal/platform/storage`.
- River jobs: `media.process`, `media.delete_objects` (queue `media`).

## Clients

Web `app/src/modules/media`, Android `feature/media`, Apple `Features/Media`, Desktop `aedst-feature-media`. Android, Apple and Desktop are frozen ([status](/status)).

## See also

Pipeline decision: [ADR-0015](/decisions/0015-govips-and-imgproxy-media-pipeline).
