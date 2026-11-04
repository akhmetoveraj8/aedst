-- name: InsertNotification :one
-- A second insert for the same source event returns no row (ON CONFLICT DO
-- NOTHING): the caller then skips the push, so a redelivered event neither
-- duplicates the notification nor pushes twice.
INSERT INTO notifications.notifications (id, user_id, kind, title, body, link, subject_id, source_event_id, created_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
ON CONFLICT (source_event_id) DO NOTHING
RETURNING id;

-- name: BroadcastNotification :many
-- SYSTEM notification to every user this module knows (has a device,
-- preferences, or an earlier notification). One set-based INSERT; the
-- source_event_id of each row is derived from the broadcast id and the user,
-- so re-running the same broadcast inserts nothing new.
INSERT INTO notifications.notifications (id, user_id, kind, title, body, link, subject_id, source_event_id, created_at)
SELECT gen_random_uuid(), u.user_id, 'system', sqlc.arg(title), sqlc.arg(body), sqlc.arg(link), NULL,
       md5(sqlc.arg(broadcast_id)::text || u.user_id::text)::uuid, sqlc.arg(created_at)
FROM (
    SELECT user_id FROM notifications.push_devices WHERE disabled_at IS NULL
    UNION
    SELECT user_id FROM notifications.preferences
    UNION
    SELECT user_id FROM notifications.notifications
) u
ON CONFLICT (source_event_id) DO NOTHING
RETURNING id, user_id;

-- Keyset page of a user's notifications, newest first; fetch page_limit+1 and
-- see internal/shared/pagination for the contract. The first page passes an
-- open cursor (infinity / max uuid) that every row satisfies.
-- name: ListNotifications :many
SELECT id, user_id, kind, title, source_event_id, created_at, read_at, body, link, subject_id
FROM notifications.notifications
WHERE user_id = sqlc.arg(user_id)
  AND (created_at, id) < (sqlc.arg(cursor_key)::timestamptz, sqlc.arg(cursor_id)::uuid)
ORDER BY created_at DESC, id DESC
LIMIT sqlc.arg(page_limit);

-- Same as ListNotifications restricted to unread rows (partial index
-- idx_notifications_user_unread_keyset).
-- name: ListUnreadNotifications :many
SELECT id, user_id, kind, title, source_event_id, created_at, read_at, body, link, subject_id
FROM notifications.notifications
WHERE user_id = sqlc.arg(user_id)
  AND read_at IS NULL
  AND (created_at, id) < (sqlc.arg(cursor_key)::timestamptz, sqlc.arg(cursor_id)::uuid)
ORDER BY created_at DESC, id DESC
LIMIT sqlc.arg(page_limit);

-- Bounded count for the unread badge: clients show "cap+" beyond it, and the
-- query never scans more than cap index entries.
-- name: CountUnread :one
SELECT count(*)::int AS unread
FROM (
    SELECT 1 FROM notifications.notifications
    WHERE user_id = sqlc.arg(user_id) AND read_at IS NULL
    LIMIT sqlc.arg(cap)
) capped;

-- name: GetNotification :one
SELECT id, user_id, kind, title, source_event_id, created_at, read_at, body, link, subject_id
FROM notifications.notifications
WHERE id = $1;

-- name: MarkNotificationsRead :execrows
UPDATE notifications.notifications
SET read_at = sqlc.arg(read_at)
WHERE user_id = sqlc.arg(user_id) AND id = ANY (sqlc.arg(ids)::uuid[]) AND read_at IS NULL;

-- name: CountOwnedNotifications :one
SELECT count(*) FROM notifications.notifications
WHERE user_id = sqlc.arg(user_id) AND id = ANY (sqlc.arg(ids)::uuid[]);

-- name: MarkAllNotificationsRead :execrows
UPDATE notifications.notifications
SET read_at = sqlc.arg(read_at)
WHERE user_id = sqlc.arg(user_id) AND read_at IS NULL;

-- name: PurgeNotifications :execrows
DELETE FROM notifications.notifications
WHERE id IN (
    SELECT n.id FROM notifications.notifications n
    WHERE n.created_at < sqlc.arg(cutoff)::timestamptz
    LIMIT sqlc.arg(row_limit)::int
);

-- name: UpsertPushDevice :one
-- (platform, address) is one installation: re-registering refreshes the keys,
-- re-activates a disabled row and moves it to the calling user (a shared
-- device that signed into another account).
INSERT INTO notifications.push_devices (id, user_id, platform, address, p256dh, auth_secret, apns_topic, apns_sandbox, device_name, locale, created_at, updated_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
ON CONFLICT (platform, address) DO UPDATE
SET user_id      = EXCLUDED.user_id,
    p256dh       = EXCLUDED.p256dh,
    auth_secret  = EXCLUDED.auth_secret,
    apns_topic   = EXCLUDED.apns_topic,
    apns_sandbox = EXCLUDED.apns_sandbox,
    device_name  = EXCLUDED.device_name,
    locale       = EXCLUDED.locale,
    updated_at   = EXCLUDED.updated_at,
    disabled_at  = NULL
RETURNING id;

-- name: CountActivePushDevices :one
SELECT count(*) FROM notifications.push_devices
WHERE user_id = $1 AND disabled_at IS NULL;

-- name: CountAllActivePushDevices :one
SELECT count(*) FROM notifications.push_devices WHERE disabled_at IS NULL;

-- name: UnregisterPushDevice :execrows
UPDATE notifications.push_devices
SET disabled_at = sqlc.arg(at), updated_at = sqlc.arg(at)
WHERE id = sqlc.arg(id) AND user_id = sqlc.arg(user_id) AND disabled_at IS NULL;

-- name: DeactivatePushDevice :exec
UPDATE notifications.push_devices
SET disabled_at = sqlc.arg(at), updated_at = sqlc.arg(at)
WHERE id = sqlc.arg(id) AND disabled_at IS NULL;

-- name: ListActivePushDevices :many
SELECT id, user_id, platform, address, p256dh, auth_secret, apns_topic, apns_sandbox, device_name, locale, created_at, updated_at, disabled_at
FROM notifications.push_devices
WHERE user_id = $1 AND disabled_at IS NULL
ORDER BY created_at
LIMIT 100;

-- name: GetActivePushDevice :one
SELECT id, user_id, platform, address, p256dh, auth_secret, apns_topic, apns_sandbox, device_name, locale, created_at, updated_at, disabled_at
FROM notifications.push_devices
WHERE id = $1 AND disabled_at IS NULL;

-- name: PurgeDisabledPushDevices :execrows
DELETE FROM notifications.push_devices
WHERE id IN (
    SELECT d.id FROM notifications.push_devices d
    WHERE d.disabled_at < sqlc.arg(cutoff)::timestamptz
    LIMIT sqlc.arg(row_limit)::int
);

-- name: GetPreferences :one
SELECT user_id, push_enabled, task_completed, task_due_soon, media_ready, updated_at
FROM notifications.preferences
WHERE user_id = $1;

-- name: UpsertPreferences :one
INSERT INTO notifications.preferences (user_id, push_enabled, task_completed, task_due_soon, media_ready, updated_at)
VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (user_id) DO UPDATE
SET push_enabled   = EXCLUDED.push_enabled,
    task_completed = EXCLUDED.task_completed,
    task_due_soon  = EXCLUDED.task_due_soon,
    media_ready    = EXCLUDED.media_ready,
    updated_at     = EXCLUDED.updated_at
RETURNING user_id, push_enabled, task_completed, task_due_soon, media_ready, updated_at;
