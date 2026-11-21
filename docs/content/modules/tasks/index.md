---
title: "Tasks"
description: "The tasks module: the reference vertical slice. What it owns, its features, API, events, storage and clients."
---

# Tasks

A user's tasks: create, read, list, edit, delete, complete and reopen, plus due-soon reminders. It is the reference module every other module copies, and it imports no other module.

Server code: `apps/server/internal/modules/tasks/` · contract: `apps/server/api/proto/aedst/tasks/v1/` · [API reference](/modules/tasks/api) · [OpenAPI 3.1](/openapi/aedst.tasks.v1.yaml).

## Features

| Feature | What it does |
|---|---|
| `features/core` | Create, read, list (typed filters, sort enum, keyset), edit (`update_mask`, `expected_version`), delete, counts |
| `features/completion` | `CompleteTask` and `ReopenTask`, guarded in SQL, and the `TaskCompleted` event |
| `features/reminders` | River job `tasks.due_reminder`, its scheduler and the guarded `TaskDueSoon` write (serves no RPC) |
| `features/operator` | Cross-owner list, counts and delete behind `TasksOperatorService` |

## API

`aedst.tasks.v1.TasksService` (signed-in user, own data) and `aedst.tasks.v1.TasksOperatorService` (staff and machine identity).

## Events

| Direction | Events |
|---|---|
| Publishes | `tasks.v1.TaskCreated`, `tasks.v1.TaskUpdated`, `tasks.v1.TaskCompleted`, `tasks.v1.TaskDeleted`, `tasks.v1.TaskDueSoon`. Payload contract: Protobuf messages in `apps/server/api/proto/aedst/tasks/events/v1/` ([reference](/modules/tasks/events)), JSON on the wire. |
| Consumes | None. |

## Storage and jobs

- Storage: Schema `tasks`: `tasks.tasks`, `tasks.due_soon_marks`. Migrations in `apps/server/migrations/tasks/`, queries in `apps/server/sql/tasks/`.
- River jobs: `tasks.due_reminder` (queue `default`).

## Clients

Web `app/src/modules/tasks`, Android `feature/tasks`, Apple `Features/Tasks`, Desktop `aedst-feature-tasks`. Android, Apple and Desktop are frozen ([status](/status)).

## See also

Behaviour spec shared by all clients: [features/tasks](/features/tasks).
