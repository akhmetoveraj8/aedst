import * as Sentry from "@sentry/react";
import type { AnyRouter } from "@tanstack/react-router";

import { adminEnv } from "@/app/config/env";
import { sentrySharedOptions } from "@/app/config/sentry/shared";

/**
 * Error and performance reporting only. The admin panel has no consent
 * banner, so Session Replay (behavioural recording) is never loaded.
 * Traces propagate through the same-origin `/api/rpc` BFF to apps/server.
 * Without a DSN the SDK stays inert.
 */
export function initSentryClient(router: AnyRouter) {
  Sentry.init({
    ...sentrySharedOptions,
    release: adminEnv.VITE_SENTRY_RELEASE,
    integrations: [Sentry.tanstackRouterBrowserTracingIntegration(router)],
    tracePropagationTargets: [/\/api\/rpc\//],
    propagateTraceparent: true,
  });
}
