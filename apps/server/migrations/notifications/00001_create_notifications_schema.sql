-- +goose Up
CREATE SCHEMA IF NOT EXISTS notifications;

-- The notifications module is a pure consumer: every row is a projection of
-- an integration event published by another module (see
-- docs/content/server/events.md). user_id has no FK to auth.* — modules never
-- reference another module's schema, not even by constraint (database.md).
CREATE TABLE notifications.notifications (
    id              UUID PRIMARY KEY,
    user_id         UUID NOT NULL,
    kind            TEXT NOT NULL,
    title           TEXT NOT NULL,
    -- The event this notification was derived from. UNIQUE makes the projection
    -- idempotent under at-least-once delivery (River retries).
    source_event_id UUID NOT NULL UNIQUE,
    created_at      TIMESTAMPTZ NOT NULL,
    read_at         TIMESTAMPTZ,
    -- In-app inbox fields used by NotificationsService (notifications.proto).
    body            TEXT NOT NULL DEFAULT '',
    link            TEXT NOT NULL DEFAULT '',
    subject_id      UUID
);

-- Keyset pagination of a user's feed, newest first (internal/shared/pagination):
-- owner id leads (the shard key, ADR-0010), then the sort order.
CREATE INDEX idx_notifications_user_created_keyset
    ON notifications.notifications (user_id, created_at, id);

-- Unread-only listing and the unread badge count: a partial index holds only
-- unread rows, so both stay cheap however large the read history grows.
CREATE INDEX idx_notifications_user_unread_keyset
    ON notifications.notifications (user_id, created_at, id)
    WHERE read_at IS NULL;

-- Retention purges old notifications by age (AEDST_RETENTION_NOTIFICATION_DAYS).
CREATE INDEX idx_notifications_created_at ON notifications.notifications (created_at);

-- Push channels. address is the FCM/APNs device token or the Web Push
-- endpoint URL; (platform, address) identifies one installation, so a token
-- that re-registers (or moves to another account on a shared device) updates
-- its row instead of duplicating it. disabled_at is set when the provider
-- reports the token invalid or the user unregisters.
CREATE TABLE notifications.push_devices (
    id           UUID PRIMARY KEY,
    user_id      UUID        NOT NULL,
    platform     TEXT        NOT NULL CHECK (platform IN ('web_push', 'fcm', 'apns')),
    address      TEXT        NOT NULL,
    p256dh       TEXT        NOT NULL DEFAULT '',
    auth_secret  TEXT        NOT NULL DEFAULT '',
    apns_topic   TEXT        NOT NULL DEFAULT '',
    apns_sandbox BOOLEAN     NOT NULL DEFAULT false,
    device_name  TEXT        NOT NULL DEFAULT '',
    locale       TEXT        NOT NULL DEFAULT '',
    created_at   TIMESTAMPTZ NOT NULL,
    updated_at   TIMESTAMPTZ NOT NULL,
    disabled_at  TIMESTAMPTZ,
    UNIQUE (platform, address)
);

-- Fan-out reads a user's active devices.
CREATE INDEX idx_push_devices_user_active ON notifications.push_devices (user_id)
    WHERE disabled_at IS NULL;
-- Retention purges long-disabled devices.
CREATE INDEX idx_push_devices_disabled_at ON notifications.push_devices (disabled_at)
    WHERE disabled_at IS NOT NULL;

-- Per-user switches; a missing row means "everything on" (domain.DefaultPreferences).
CREATE TABLE notifications.preferences (
    user_id        UUID PRIMARY KEY,
    push_enabled   BOOLEAN     NOT NULL DEFAULT true,
    task_completed BOOLEAN     NOT NULL DEFAULT true,
    task_due_soon  BOOLEAN     NOT NULL DEFAULT true,
    media_ready    BOOLEAN     NOT NULL DEFAULT true,
    updated_at     TIMESTAMPTZ NOT NULL
);

-- +goose Down
DROP TABLE notifications.preferences;
DROP TABLE notifications.push_devices;
DROP TABLE notifications.notifications;
DROP SCHEMA notifications;
