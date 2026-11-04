/// <reference lib="webworker" />
import { createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import {
  CacheFirst,
  ExpirationPlugin,
  NetworkOnly,
  type PrecacheEntry,
  type RuntimeCaching,
  Serwist,
  type SerwistGlobalConfig,
  StaleWhileRevalidate,
} from "serwist";

import { NotificationsService } from "@/shared/api/connect/generated/aedst/notifications/v1/notifications_pb";
import { defaultLocale, locales } from "@/shared/i18n/locales";
import { setAppBadge } from "@/shared/lib/pwa/app-badge";
import { buildRegisterPushDeviceRequest } from "@/shared/lib/pwa/push-device";
import {
  parsePushPayload,
  resolveNotificationUrl,
} from "@/shared/lib/pwa/push-payload";

// Same-origin BFF (/api/rpc): fetch sends the session cookie, tokens never
// reach the worker. Connect sets the protocol-version and content-type headers.
const notifications = createClient(
  NotificationsService,
  createConnectTransport({ baseUrl: "/api/rpc" }),
);

/**
 * The service worker (bundled by Serwist at build time, served from
 * `/serwist/sw.js` — see `app/serwist/[path]/route.ts`).
 *
 * Caching policy — the one rule: **nothing that belongs to a user is ever
 * cached**. That rules out the API (`/api/rpc` is POST, and is explicitly
 * NetworkOnly anyway), the Sentry/PostHog proxies, and *every HTML page*:
 * pages are per-user and rendered with a per-request CSP nonce, so a cached
 * copy would be both a privacy leak on a shared device and stale. What is
 * cached is what is identical for everyone:
 * - the precache: `public/` plus a localized, script-free offline page per
 *   locale (deliberately small — see app/serwist/[path]/route.ts);
 * - at runtime: hashed Next assets, fonts and our own icons.
 * Media variants are short-lived presigned URLs from object storage —
 * deliberately not cached (they expire and are private).
 */

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    // biome-ignore lint/style/useNamingConvention: global injected by Serwist
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const sameOrigin = (url: URL) => url.origin === self.location.origin;

const runtimeCaching: RuntimeCaching[] = [
  {
    // Never cache: API, auth, telemetry proxies.
    matcher: ({ url }) =>
      sameOrigin(url) && /^\/(api|monitoring|ingest)(\/|$)/.test(url.pathname),
    handler: new NetworkOnly(),
  },
  {
    // Content-hashed build output: immutable, safe to serve from cache.
    matcher: ({ url }) =>
      sameOrigin(url) && url.pathname.startsWith("/_next/static/"),
    handler: new CacheFirst({
      cacheName: "next-static",
      plugins: [
        new ExpirationPlugin({
          maxEntries: 256,
          maxAgeSeconds: 30 * 24 * 3600,
        }),
      ],
    }),
  },
  {
    matcher: ({ url, request }) =>
      sameOrigin(url) &&
      (request.destination === "font" ||
        /^\/(icons|favicon\.ico)/.test(url.pathname)),
    handler: new StaleWhileRevalidate({
      cacheName: "static-assets",
      plugins: [
        new ExpirationPlugin({ maxEntries: 64, maxAgeSeconds: 30 * 24 * 3600 }),
      ],
    }),
  },
  {
    // Pages: always the network (per-user, nonce-bound). When the network
    // fails, the offline fallback below answers instead.
    matcher: ({ request }) => request.mode === "navigate",
    handler: new NetworkOnly(),
  },
];

const offlineFallbacks = [
  ...locales.map((locale) => ({
    url: `/offline/${locale}`,
    matcher: ({ request }: { request: Request }) =>
      request.mode === "navigate" &&
      new URL(request.url).pathname.split("/")[1] === locale,
  })),
  {
    url: `/offline/${defaultLocale}`,
    matcher: ({ request }: { request: Request }) => request.mode === "navigate",
  },
];

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  // A new deployment takes over on the next navigation instead of waiting
  // for every tab to close; the app shows a "new version" toast.
  skipWaiting: false,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching,
  fallbacks: { entries: offlineFallbacks },
});

serwist.addEventListeners();

// The page asks the waiting worker to take over ("Reload" in the update toast).
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    void self.skipWaiting();
  }
});

// Signing out clears everything this origin cached for the device.
self.addEventListener("message", (event) => {
  if (event.data?.type === "CLEAR_RUNTIME_CACHES") {
    event.waitUntil(
      caches
        .keys()
        .then((keys) =>
          Promise.all(
            keys
              .filter((key) => !key.includes("precache"))
              .map((key) => caches.delete(key)),
          ),
        ),
    );
  }
});

// --- Web Push -------------------------------------------------------------

self.addEventListener("push", (event) => {
  const payload = parsePushPayload(event.data?.text());
  if (!payload) {
    return;
  }
  event.waitUntil(
    Promise.all([
      // Plain badge dot; the open bell replaces it with the exact count.
      setAppBadge(),
      self.registration.showNotification(payload.title, {
        body: payload.body,
        tag: payload.tag,
        icon: "/icons/icon-192.png",
        badge: "/icons/badge-96.png",
        lang: payload.lang,
        data: { url: payload.link, id: payload.id, kind: payload.kind },
      }),
    ]),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data as {
    url?: string;
    kind?: string;
  } | null;
  const target = resolveNotificationUrl(data?.url, self.location.origin);
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      const existing = windows.find((client) =>
        client.url.startsWith(self.location.origin),
      );
      if (existing) {
        await existing.focus();
        // Tell the app (analytics + cache invalidation), then navigate.
        existing.postMessage({
          type: "NOTIFICATION_CLICKED",
          kind: data?.kind,
        });
        try {
          await existing.navigate(target);
          return;
        } catch {
          // navigate() rejects for a client this worker does not control; open a window instead.
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});

// The browser rotated the subscription: re-subscribe with the same VAPID key
// and re-register it, so pushes keep arriving without the user doing
// anything. Best effort — the app re-registers on its next start as well.
self.addEventListener("pushsubscriptionchange", (event) => {
  const change = event as Event & {
    oldSubscription?: PushSubscription | null;
    waitUntil: (promise: Promise<unknown>) => void;
  };
  const key = change.oldSubscription?.options.applicationServerKey;
  if (!key) {
    return;
  }
  change.waitUntil(
    (async () => {
      try {
        const subscription = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: key,
        });
        const request = buildRegisterPushDeviceRequest(subscription.toJSON());
        if (request) {
          await notifications.registerPushDevice(request);
        }
      } catch (error) {
        // Expired session or offline: the app re-registers on its next start,
        // but the failure must not vanish inside waitUntil.
        await relayErrorToPages("notifications", error);
      }
    })(),
  );
});

/**
 * The worker has no Sentry client: hand the error to any open page, whose
 * notification bell reports it (source "service-worker").
 */
async function relayErrorToPages(feature: string, error: unknown) {
  const windows = await self.clients.matchAll({ type: "window" });
  for (const client of windows) {
    client.postMessage({
      type: "SW_ERROR",
      feature,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
