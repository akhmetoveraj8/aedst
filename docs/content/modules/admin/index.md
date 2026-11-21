---
title: "Admin"
description: "The admin module: operator composition over other modules with an audit log. API, storage and clients."
---

# Admin

Operator actions and their audit log. It composes other modules through their `api/` packages; nothing depends on it.

Server code: `apps/server/internal/modules/admin/` · contract: `apps/server/api/proto/aedst/admin/v1/` · [API reference](/modules/admin/api) · [OpenAPI 3.1](/openapi/aedst.admin.v1.yaml).

## Features

| Feature | What it does |
|---|---|
| (flat, one capability) | Overview counters, cross-user task list and delete, broadcast notification, audit log |

## API

`aedst.admin.v1.AdminService` (role `admin`, closed by default in `AEDST_ROLE_POLICY`).

## Events

| Direction | Events |
|---|---|
| Publishes | None of its own; the owning module publishes its events (for example `TaskDeleted`). |
| Consumes | None. |

## Storage and jobs

- Storage: Schema `admin`: `admin.audit_log` (append only; an entry leaves `pending` once).
- River jobs: `admin.apply` (applies a pending audit entry through the owner's operator service when the owner runs in another process).

## Clients

Web `admin/src/modules/admin`, Android `feature/admin`, Apple `Features/Admin`, Desktop `aedst-feature-admin`. Android, Apple and Desktop are frozen ([status](/status)).
