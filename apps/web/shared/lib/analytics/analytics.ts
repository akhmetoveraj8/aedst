import type { PostHog } from "posthog-js";

import { clientEnv } from "@/shared/env/client";
import { redactSensitiveParams } from "@/shared/lib/utils/sensitive-params";

/**
 * Product analytics + feature flags (PostHog), behind three gates:
 *
 * 1. **Configured** — no `NEXT_PUBLIC_POSTHOG_KEY`, no PostHog. Ever.
 * 2. **Consented** — nothing is loaded, stored or sent until the visitor
 *    grants analytics consent (`ConsentLayer` calls `enableAnalytics`).
 *    The SDK is a dynamic import, so it is not in anyone's first-load
 *    bundle, and never in the bundle of a visitor who declines.
 * 3. **Not opted out by the browser** — Do Not Track / Global Privacy
 *    Control win over a granted banner.
 *
 * Events go to this app's own `/ingest` rewrite (next.config.ts), so ad
 * blockers do not drop them and the CSP needs no PostHog origin. Errors are
 * Sentry's job and session replay is Sentry's (consent-gated) Replay, so
 * PostHog's exception capture and recordings stay off — one tool per job.
 */

/**
 * Every analytics event and its properties. Properties are product facts,
 * never PII (no emails, titles, free text, file names). Add events here —
 * `track()` only accepts names from this map.
 */
export type AnalyticsEvents = {
  task_created: { priority: string; has_due_date: boolean };
  task_completed: Record<string, never>;
  search_performed: { query_length: number; results: number };
  search_result_opened: { kind: string; position: number };
  command_palette_opened: { via: "shortcut" | "button" };
  media_uploaded: {
    kind: string;
    size_bytes: number;
    compressed: boolean;
    attached_to_task: boolean;
  };
  media_upload_failed: { reason: string };
  notification_opened: { kind: string; via: "inbox" | "push" };
  notifications_marked_read: { count: number };
  push_opt_in: { result: "granted" | "denied" | "unsupported" | "error" };
  pwa_install_prompt: { outcome: "accepted" | "dismissed" };
  admin_task_deleted: Record<string, never>;
  admin_broadcast_sent: { audience: "user" | "everyone" };
  /** Core Web Vitals from real sessions (field data), reported by `WebVitals`. */
  web_vital: {
    name: "CLS" | "FCP" | "INP" | "LCP" | "TTFB";
    /** ms, except CLS (unitless score). */
    value: number;
    rating: "good" | "needs-improvement" | "poor";
    navigation_type: string;
  };
};

/** Default values used whenever flags are unavailable (no key, no consent, offline). */
export const FEATURE_FLAG_DEFAULTS = {
  "command-palette": true,
  "client-image-compression": true,
} as const satisfies Record<string, boolean | string>;

export type FeatureFlag = keyof typeof FEATURE_FLAG_DEFAULTS;

let client: PostHog | null = null;
let loading: Promise<PostHog | null> | null = null;
/** Latest known signed-in user, applied as soon as the SDK is up. */
let currentUserId: string | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) {
    listener();
  }
}

/** Do Not Track or Global Privacy Control set by the browser/user agent. */
export function isTrackingBlockedByBrowser(): boolean {
  if (typeof navigator === "undefined") {
    return true;
  }
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  const win = window as Window & { doNotTrack?: string };
  return (
    nav.globalPrivacyControl === true ||
    nav.doNotTrack === "1" ||
    win.doNotTrack === "1"
  );
}

const URL_PROPERTIES = ["$current_url", "$referrer", "$initial_referrer"];

/**
 * PostHog `before_send`: strips sensitive query parameters (search text,
 * `next`, credentials) from the URLs on every event, pageviews included.
 */
export function sanitizeEvent<
  T extends { properties?: Record<string, unknown> },
>(event: T | null): T | null {
  const properties = event?.properties;
  if (properties) {
    for (const name of URL_PROPERTIES) {
      const value = properties[name];
      if (typeof value === "string") {
        properties[name] = redactSensitiveParams(value);
      }
    }
  }
  return event;
}

/** PostHog's app host for a given ingestion host (eu.i.posthog.com → eu.posthog.com). */
export function toPostHogUiHost(ingestHost: string): string {
  return ingestHost.replace(".i.posthog.com", ".posthog.com");
}

/**
 * Loads and starts PostHog. Call only after consent; a no-op without a key
 * or when the browser asks not to be tracked. Safe to call repeatedly.
 */
export function enableAnalytics(): Promise<PostHog | null> {
  const key = clientEnv.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key || isTrackingBlockedByBrowser()) {
    return Promise.resolve(null);
  }
  if (client) {
    client.opt_in_capturing();
    return Promise.resolve(client);
  }
  loading ??= import("posthog-js").then(({ default: posthog }) => {
    posthog.init(key, {
      api_host: "/ingest",
      ui_host: toPostHogUiHost(clientEnv.NEXT_PUBLIC_POSTHOG_HOST),
      defaults: "2026-08-30",
      person_profiles: "identified_only",
      capture_pageview: "history_change",
      // Autocapture records clicks, never what was typed; masking keeps
      // element text/attributes (which can contain user content) out.
      mask_all_text: true,
      mask_all_element_attributes: true,
      respect_dnt: true,
      before_send: sanitizeEvent,
      // Session replay lives in Sentry Replay only (it is tied to errors, see
      // docs/content/decisions.md); PostHog stays analytics + feature flags. This
      // also keeps the recorder out of the loaded SDK.
      disable_session_recording: true,
      capture_exceptions: false,
      disable_surveys: true,
      // Strict CSP: no scripts from PostHog's CDN (surveys, toolbar, …).
      disable_external_dependency_loading: true,
      loaded: (instance) => {
        if (currentUserId) {
          instance.identify(currentUserId);
        }
      },
    });
    posthog.onFeatureFlags(notify);
    client = posthog;
    notify();
    return posthog;
  });
  return loading;
}

/** Consent withdrawn: stop capturing and forget this browser's identity. */
export function disableAnalytics() {
  if (client) {
    client.opt_out_capturing();
    client.reset();
  }
  notify();
}

/** Mirror the session into analytics: id only (never email or name). */
export function identifyUser(userId: string | null) {
  const previous = currentUserId;
  currentUserId = userId;
  if (!client || previous === userId) {
    return;
  }
  if (userId) {
    client.identify(userId);
  } else {
    // Signed out: a new anonymous id, so the next person on this device is
    // not stitched onto the previous user.
    client.reset();
  }
}

/** Typed, consent-safe capture. A no-op until analytics is enabled. */
export function track<E extends keyof AnalyticsEvents>(
  event: E,
  ...[properties]: AnalyticsEvents[E] extends Record<string, never>
    ? []
    : [AnalyticsEvents[E]]
) {
  client?.capture(event, properties);
}

/** For `useFeatureFlag`: subscribe to flag/SDK changes. */
export function subscribeToAnalytics(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function readFeatureFlag<F extends FeatureFlag>(
  flag: F,
): (typeof FEATURE_FLAG_DEFAULTS)[F] {
  const value = client?.getFeatureFlag(flag);
  const fallback = FEATURE_FLAG_DEFAULTS[flag];
  if (value === undefined || typeof value !== typeof fallback) {
    return fallback;
  }
  return value as (typeof FEATURE_FLAG_DEFAULTS)[F];
}

/** Test seam: forget the loaded SDK. */
export function resetAnalyticsForTests() {
  client = null;
  loading = null;
  currentUserId = null;
  listeners.clear();
}
