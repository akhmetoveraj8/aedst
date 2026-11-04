---
title: "Push notifications (canonical reference)"
description: "This is the single place that describes device registration, the payload contract and VAPID key rotation. Other documents link here and do not repeat it...."
---

# Push notifications (canonical reference)

This is the single place that describes device registration, the payload
contract and VAPID key rotation. Other documents link here and do not repeat it.
Code: `internal/platform/push` (transport only), `internal/modules/notifications`
(device bookkeeping, fan-out as River jobs), `api/proto/aedst/notifications/v1/notifications.proto`.

Providers are maintained libraries (`webpush-go`, Firebase Admin Go `messaging`,
`apns2`); never hand-write ECE, VAPID/APNs JWTs or FCM OAuth (see
`library-first.md`). A provider whose configuration is empty is disabled and
sending to it is skipped (`ErrDisabled`).

## Registering a device

Clients call `NotificationsService.RegisterPushDevice` once per install (or per
browser subscription) and again whenever the platform rotates the token or the
subscription changes. `(platform, address)` identifies one installation:
re-registering refreshes the keys, re-activates a disabled row and moves it to
the calling user (shared device). `UnregisterPushDevice(device_id)` on sign-out.

| Platform | `platform` | What the client sends |
|---|---|---|
| Browser (Push API) | `PUSH_PLATFORM_WEB_PUSH` | `web_push` = `{endpoint, p256dh, auth}` (below); `token` empty |
| Android | `PUSH_PLATFORM_FCM` | `token` = FCM registration token |
| iOS / iPadOS / macOS / tvOS / visionOS | `PUSH_PLATFORM_APNS` | `token` = APNs device token (hex), `apns_topic` = bundle id, `apns_sandbox` = true for debug/TestFlight-sandbox tokens |
| Desktop | none | No push service: the tray app polls `GetUnreadCount` with backoff |

Optional on every registration: `device_name` (<= 120 chars), `locale`.

### Web Push subscription shape

The browser's `PushSubscription.toJSON()` returns:

```json
{
  "endpoint": "https://fcm.googleapis.com/fcm/send/...",
  "expirationTime": null,
  "keys": { "p256dh": "<base64url, 65-byte uncompressed P-256 point>", "auth": "<base64url, 16 bytes>" }
}
```

Map it to the RPC field-for-field (`expirationTime` is not sent):

```json
{ "platform": "PUSH_PLATFORM_WEB_PUSH",
  "webPush": { "endpoint": "...", "p256dh": "...", "auth": "..." } }
```

Validation: `endpoint` must be an `https` URI (<= 2048 chars), `p256dh` and `auth`
are base64url strings as returned by the browser (not re-encoded). The browser
subscribes with `applicationServerKey` = the `vapid_public_key` returned by
`GetWebPushConfig` (base64url uncompressed P-256 point; empty when Web Push is
not configured, in which case the client must not offer the feature).

## Payload contract

One logical message, three encodings; `link` is always a relative in-app route
(`/tasks/<id>`).

| Channel | Shape |
|---|---|
| Web Push | RFC 8291 `aes128gcm` encrypted JSON `{title, body, link, kind, notification_id, tag?, data?}`; read with `event.data.json()`. Plaintext limit 3993 bytes (larger is a permanent failure). Default TTL 24 h; `tag` is the collapse id (sent as the `Topic` header hash). |
| FCM | `data` = `{kind, title, body, link, notification_id}` (+ extras) and a `notification` block `{title, body}` |
| APNs | `aps` = `{alert: {title, body}, badge: unread count, sound: default}` plus top-level `link`, `kind`, `notification_id` |

Delivery runs as River jobs (`notifications.push` per notification,
`notifications.push_device` per device). Provider answers are classified:
HTTP 404/410 (or an equivalent invalid-token error) -> the device is deactivated
(`disabled_at`, purged later by retention); 429/5xx and network errors -> retried
with backoff; any other 4xx -> dropped as a permanent failure and logged.

## Configuration

| Variable | Meaning |
|---|---|
| `AEDST_PUSH_VAPID_PRIVATE_KEY` | base64url raw P-256 scalar (32 bytes); enables Web Push |
| `AEDST_PUSH_VAPID_PUBLIC_KEY` | optional; derived from the private key and must match it when set |
| `AEDST_PUSH_VAPID_SUBJECT` | `mailto:` or `https:` contact, required with the private key |
| `AEDST_PUSH_FCM_CREDENTIALS_JSON` / `_FILE`, `AEDST_PUSH_FCM_PROJECT_ID` | FCM service account |
| `AEDST_PUSH_APNS_KEY_ID`, `_TEAM_ID`, `_PRIVATE_KEY` / `_PRIVATE_KEY_FILE`, `_TOPIC` | APNs token auth |

Generate a VAPID pair once per deployment (`npx web-push generate-vapid-keys`).

## VAPID key rotation

A browser subscription is bound to the `applicationServerKey` it was created
with; the push service rejects messages signed with a different key. Rotation
therefore requires every browser to resubscribe.

**What the server supports today: exactly one VAPID key** (`WebPushConfig` holds
a single pair). A dual-key overlap, where old and new subscriptions are both
served during a grace period, is **not implemented**; it would need a per-device
key identifier (a `vapid_key_id` column set at registration), a
`AEDST_PUSH_VAPID_PREVIOUS_*` pair and a send-time key choice. Until then, use the
cutover procedure below and expect web notifications to be degraded for devices
that have not yet resubscribed.

Supported procedure (single key, planned cutover):

1. Generate the new pair; store it in the secret manager. Do not delete the old one yet.
2. Make sure the web client compares the stored subscription's
   `options.applicationServerKey` with `GetWebPushConfig().vapid_public_key` on
   every app start (and when the notifications settings page opens). On a
   mismatch it unsubscribes (`subscription.unsubscribe()`), subscribes with the
   new key and calls `RegisterPushDevice` again. Ship this client release first,
   so resubscription happens by itself right after the switch.
3. Roll out the new `AEDST_PUSH_VAPID_*` values to all server replicas and
   workers (one rollout; `GetWebPushConfig` then returns the new public key).
   If the public key variable is set explicitly, change it in the same rollout:
   the server refuses to start when it does not match the private key.
4. Watch `push: ...` warnings and the push-device count. Old-key subscriptions
   answer 401/403/400 from the push service. These are classified as permanent
   failures (dropped and logged), **not** as invalid tokens, so they are not
   pruned automatically; only 404/410 prune a device.
5. After the grace period (suggested: two weeks, longer than most users take to
   open the app), disable the devices that never re-registered, then keep the
   usual retention purge for disabled rows:

   ```sql
   UPDATE notifications.push_devices
   SET disabled_at = now()
   WHERE platform = 'web_push' AND disabled_at IS NULL
     AND updated_at < '<cutover timestamp>';
   ```

   (`updated_at` is refreshed by every `RegisterPushDevice`, so devices that
   resubscribed after the cutover are untouched.)
6. Destroy the old private key. Record the rotation date in the runbook log.

A compromised private key is rotated the same way but without the grace period
(skip step 5's waiting: disable stale rows at the cutover).

FCM and APNs credentials rotate independently of this procedure: add the new
FCM service-account key or APNs auth key (`.p8`, new key id) in the secret and
roll out; device tokens do not change.
