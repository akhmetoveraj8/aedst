---
title: "Notifications"
description: "The notifications module: in-app inbox, preferences and push fan-out. API, events, storage and clients."
---

# Notifications

The in-app inbox, per-kind preferences and push delivery (Web Push, FCM, APNs). It is a consumer: no module calls it synchronously.

Server code: `apps/server/internal/modules/notifications/` · contract: `apps/server/api/proto/aedst/notifications/v1/` · [API reference](/modules/notifications/api) · [OpenAPI 3.1](/openapi/aedst.notifications.v1.yaml).

## Features

| Feature | What it does |
|---|---|
| (flat, one capability) | Inbox list and unread count, mark read, push device registration, preferences, push fan-out jobs |

## API

`aedst.notifications.v1.NotificationsService` (signed-in user) and `aedst.notifications.v1.NotificationsOperatorService` (staff and machine identity).

## Events

| Direction | Events |
|---|---|
| Publishes | None. |
| Consumes | `tasks.v1.TaskCompleted`, `tasks.v1.TaskDueSoon`, `media.v1.MediaReady` (idempotent on the event id). |

## Storage and jobs

- Storage: Schema `notifications`: `notifications.notifications`, `notifications.push_devices`, `notifications.preferences`.
- River jobs: `notifications.push`, `notifications.push_device` (queue `default`).

## Clients

Web `app/src/modules/notifications`, Android `feature/notifications`, Apple `Features/Notifications`, Desktop `aedst-feature-notifications` (Desktop has no push service and polls `GetUnreadCount`). Android, Apple and Desktop are frozen ([status](/status)).

## See also

Device registration and the payload contract: [Push notifications](/server/push).
