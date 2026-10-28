import * as Sentry from "@sentry/nextjs";

import { sentrySharedOptions } from "@/app/config/sentry/shared";

/**
 * Error and performance reporting only. The admin panel has no consent
 * banner, so Session Replay (behavioural recording) is never loaded.
 * Traces propagate through the same-origin `/api/rpc` BFF to apps/server.
 */
export function initSentryClient() {
  Sentry.init({
    ...sentrySharedOptions,
    tracePropagationTargets: [/\/api\/rpc\//],
    propagateTraceparent: true,
  });
}
