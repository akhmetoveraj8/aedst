# Spec: notifications/inbox-and-push

Type: Command + Query
Module: notifications
Status: Implemented

## Context

The template's global notifications module: an in-app inbox (a projection of other modules' events),
a registry of push devices, user settings, and push delivery via Web
Push (VAPID, `webpush-go`), FCM (Firebase Admin Go, `messaging` client) and APNs
(`sideshow/apns2`, token auth). Providers are used only through libraries, behind
`internal/platform/push`. The module is never called synchronously to
create a notification; it consumes integration events (`tasks.v1.TaskCompleted`,
`tasks.v1.TaskDueSoon`, `media.v1.MediaReady`) with idempotent handlers (River delivery, a transaction on the jobs pool). The only
synchronous write point is `api.Broadcaster` for the admin module.

## Scenarios

**Happy path**

- Given a River delivery job for `tasks.v1.TaskCompleted` for the consumer `notifications.task_completed`
- When a worker runs the handler
- Then in one transaction a row in `notifications.notifications` is created
  and a River job `notifications.push` is enqueued (redelivery of the same event changes nothing: UNIQUE source_event_id);
  the job fans delivery out to `notifications.push_device` (one per active
  device), and each sends a push to the platform's provider.

- Given a client obtained an FCM/APNs token or a PushSubscription
- When it calls `RegisterPushDevice`
- Then the device is upserted by `(platform, address)` and activated.

**Edge cases**

- Redelivery of an event → `ON CONFLICT (source_event_id) DO NOTHING`, the push is not enqueued again.
- The provider answers 404/410/`Unregistered`/`BadDeviceToken`/`UNREGISTERED` → the device is deactivated, the job succeeds.
- 429/5xx → River retries only that device job.
- Provider not configured → the device is skipped (`push.ErrDisabled`).
- Settings `push_enabled=false` or a disabled kind → the in-app record is created, no push.
- More than 20 active devices → `INVALID_ARGUMENT`.
- The device moved to another account after the fan-out → no push is sent.

## Errors

| Condition | `sharederrors.Kind` | `connect.Code` |
| --------- | ------------------- | -------------- |
| Someone else's / nonexistent id in MarkRead/UnregisterPushDevice | NotFound | NOT_FOUND |
| Invalid subscription/token, device limit, foreign cursor | Validation | INVALID_ARGUMENT |
| No identity | Unauthorized | UNAUTHENTICATED |

## API

`aedst.notifications.v1.NotificationsService` (see `api/proto/aedst/notifications/v1/notifications.proto`).

## Events

| Event type | Version | partition_key | Payload | Consumers |
| ---------- | ------- | ------------- | ------- | --------- |
| (consumes) tasks.v1.TaskCompleted / TaskDueSoon | 1 | task_id | tasks/api/events.go | notifications |
| (consumes) media.v1.MediaReady | 1 | media_id | media/api/events.go | notifications |

## Push payload (client contract)

- FCM: `data` = `{kind, title, body, link, notification_id}` + a `notification` block.
- APNs: `aps` = `{alert:{title,body}, badge: unread count, sound: default}`, with the keys `link`, `kind`, `notification_id` alongside.
- Web Push: encrypted (RFC 8291) JSON `{title, body, link, kind, notification_id}`.

## Cross-module dependencies

Only through `tasks/api` and `media/api` (event types). Admin calls `api.Broadcaster.BroadcastTx` in its audit transaction.

## NFR

- Idempotency: projections are idempotent handlers + UNIQUE source_event_id; Register is an upsert.
- Retention: notifications `AEDST_RETENTION_NOTIFICATION_DAYS` (90), disabled devices 30 days.
- Hot path: `ListNotifications`, `GetUnreadCount` (a bounded counter, cap 1000).
