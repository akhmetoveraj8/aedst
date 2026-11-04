/**
 * Web Push on the web, with the platform's standard Push API only (no Firebase
 * SDK): subscribe with the server's VAPID key, then RegisterPushDevice(WEB_PUSH).
 *
 * The subscription JSON shape, the `RegisterPushDevice` mapping, the
 * `applicationServerKey` source (`GetWebPushConfig`) and the VAPID key rotation
 * procedure are defined once, in docs/content/server/push.md. Do not restate
 * them here; change that document first.
 */

/** Where this browser's registered push device id is remembered (not secret). */
const DEVICE_KEY = "aedst-push-device-id";

export type PushSupport =
  | "supported"
  /** No service worker / PushManager / Notification API. */
  | "unsupported"
  /** iOS/iPadOS Safari tab: Web Push needs the app installed to the home screen. */
  | "requires-install";

export function getPushSupport(): PushSupport {
  if (typeof window === "undefined") {
    return "unsupported";
  }
  const hasApis =
    navigator.serviceWorker !== undefined &&
    typeof PushManager !== "undefined" &&
    typeof Notification !== "undefined";
  if (hasApis) {
    return "supported";
  }
  const isIos =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.userAgent.includes("Macintosh") && navigator.maxTouchPoints > 1);
  return isIos ? "requires-install" : "unsupported";
}

/** VAPID base64url public key → the bytes `applicationServerKey` expects. */
export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export type WebPushKeys = { endpoint: string; p256dh: string; auth: string };

export function subscriptionKeys(subscription: PushSubscription): WebPushKeys {
  const json = subscription.toJSON();
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!json.endpoint || !p256dh || !auth) {
    throw new Error("push subscription is missing its keys");
  }
  return { endpoint: json.endpoint, p256dh, auth };
}

export async function getActiveSubscription(): Promise<PushSubscription | null> {
  if (getPushSupport() !== "supported") {
    return null;
  }
  const registration = await navigator.serviceWorker.getRegistration();
  return (await registration?.pushManager.getSubscription()) ?? null;
}

/** Does this subscription's `applicationServerKey` equal the server's current VAPID key? */
export function subscriptionUsesKey(
  subscription: PushSubscription,
  vapidPublicKey: string,
): boolean {
  const current = subscription.options.applicationServerKey;
  if (!current) {
    return false;
  }
  const expected = base64UrlToBytes(vapidPublicKey);
  const actual = new Uint8Array(current);
  return (
    actual.length === expected.length &&
    actual.every((byte, index) => byte === expected[index])
  );
}

/**
 * Asks for permission (must run inside a user gesture) and subscribes. An
 * existing subscription is reused only if it was made with the current VAPID
 * key; one made with a rotated-out key is unsubscribed and replaced.
 */
export async function subscribeToPush(
  vapidPublicKey: string,
): Promise<PushSubscription> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new PushPermissionError(permission);
  }
  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  if (existing) {
    if (subscriptionUsesKey(existing, vapidPublicKey)) {
      return existing;
    }
    await existing.unsubscribe();
  }
  return await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: base64UrlToBytes(vapidPublicKey),
  });
}

let rotation: Promise<PushSubscription | null> | undefined;

/**
 * VAPID key rotation (docs/content/server/push.md): if this browser has a
 * subscription bound to a different key than `vapidPublicKey`, unsubscribe and
 * subscribe again with the new key, without a permission prompt (only runs
 * when permission is already granted). Returns the NEW subscription, which the
 * caller must register with the server (`RegisterPushDevice`); returns null
 * when nothing changed. Concurrent calls share one run.
 */
export function resubscribeOnKeyRotation(
  vapidPublicKey: string,
): Promise<PushSubscription | null> {
  rotation ??= (async () => {
    if (
      !vapidPublicKey ||
      getPushSupport() !== "supported" ||
      Notification.permission !== "granted"
    ) {
      return null;
    }
    const existing = await getActiveSubscription();
    if (!existing || subscriptionUsesKey(existing, vapidPublicKey)) {
      return null;
    }
    await existing.unsubscribe();
    const registration = await navigator.serviceWorker.ready;
    return await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToBytes(vapidPublicKey),
    });
  })().finally(() => {
    rotation = undefined;
  });
  return rotation;
}

export class PushPermissionError extends Error {
  constructor(readonly permission: NotificationPermission) {
    super(`notification permission ${permission}`);
    this.name = "PushPermissionError";
  }
}

export function rememberDeviceId(deviceId: string | null) {
  try {
    if (deviceId) {
      localStorage.setItem(DEVICE_KEY, deviceId);
    } else {
      localStorage.removeItem(DEVICE_KEY);
    }
  } catch {
    // Storage disabled: the device is unregistered server-side on expiry.
  }
}

export function rememberedDeviceId(): string | null {
  try {
    return localStorage.getItem(DEVICE_KEY);
  } catch {
    return null;
  }
}

/** "Chrome · Windows" — shown in the user's device list, no fingerprinting detail. */
export function describeBrowser(userAgent: string): string {
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /Firefox\//.test(userAgent)
      ? "Firefox"
      : /Chrome\//.test(userAgent)
        ? "Chrome"
        : /Safari\//.test(userAgent)
          ? "Safari"
          : "Browser";
  const os = /Windows/.test(userAgent)
    ? "Windows"
    : /Android/.test(userAgent)
      ? "Android"
      : /iPhone|iPad|iPod/.test(userAgent)
        ? "iOS"
        : /Mac OS X/.test(userAgent)
          ? "macOS"
          : /Linux/.test(userAgent)
            ? "Linux"
            : "";
  return os ? `${browser} · ${os}` : browser;
}
