import type { Breadcrumb, ErrorEvent } from "@sentry/nextjs";

import { clientEnv } from "@/shared/env/client";
import { redactSensitiveParams } from "@/shared/lib/utils/sensitive-params";

/**
 * Values of credential-carrying query parameters (the shared list in
 * shared/lib/utils/sensitive-params) are replaced before a URL leaves the
 * process in a breadcrumb or event.
 */
export function scrubUrl(url: string): string {
  return redactSensitiveParams(url);
}

/**
 * Breadcrumbs are what an event shows the user did before it: navigation,
 * fetch/XHR and UI clicks are kept (URLs scrubbed); console noise below
 * `warn` is dropped, and nothing that looks like a bearer token survives.
 */
export function beforeBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  if (breadcrumb.category === "console") {
    if (breadcrumb.level !== "warning" && breadcrumb.level !== "error") {
      return null;
    }
  }
  const data = breadcrumb.data;
  if (data) {
    for (const field of ["url", "from", "to"] as const) {
      if (typeof data[field] === "string") {
        data[field] = scrubUrl(data[field]);
      }
    }
  }
  if (typeof breadcrumb.message === "string") {
    breadcrumb.message = breadcrumb.message.replace(
      /Bearer\s+[\w.~+/-]+=*/gi,
      "Bearer [Filtered]",
    );
  }
  return breadcrumb;
}

/** Last line of defence: no cookies, no auth headers, scrubbed URLs. */
export function beforeSend(event: ErrorEvent): ErrorEvent {
  if (event.request) {
    delete event.request.cookies;
    if (event.request.headers) {
      for (const name of Object.keys(event.request.headers)) {
        if (/^(authorization|cookie|x-api-key)$/i.test(name)) {
          event.request.headers[name] = "[Filtered]";
        }
      }
    }
    if (event.request.url) {
      event.request.url = scrubUrl(event.request.url);
    }
    if (typeof event.request.query_string === "string") {
      event.request.query_string = scrubUrl(
        `?${event.request.query_string}`,
      ).slice(1);
    }
  }
  return event;
}

/**
 * Options shared by the browser, Node and Edge SDKs. The `release` is not
 * set here on purpose: `withSentryConfig` injects the one it created at
 * build time (next.config.ts — the commit SHA in CI), which is what ties
 * events to the uploaded source maps.
 */
export const sentrySharedOptions = {
  dsn: clientEnv.NEXT_PUBLIC_SENTRY_DSN,
  environment:
    clientEnv.NEXT_PUBLIC_SENTRY_ENVIRONMENT ??
    process.env.VERCEL_ENV ??
    process.env.NODE_ENV,
  // NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE: 1 locally, 0.2 in production
  // unless configured — size it to real traffic.
  tracesSampleRate: clientEnv.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE,
  // No IP addresses, cookies or request bodies are attached automatically;
  // the user context is set explicitly to the id only (AuthProvider).
  sendDefaultPii: false,
  debug: false,
  beforeBreadcrumb,
  beforeSend,
  // Well-known noise that isn't actionable: a benign browser quirk
  // (ResizeObserver) and rejections that never had a real Error object to
  // begin with (usually a third-party script, not our code).
  ignoreErrors: [
    "ResizeObserver loop limit exceeded",
    "ResizeObserver loop completed with undelivered notifications",
    "Non-Error promise rejection captured",
  ] as string[],
};
