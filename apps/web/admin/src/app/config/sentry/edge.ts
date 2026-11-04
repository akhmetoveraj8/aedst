import * as Sentry from "@sentry/nextjs";

import { apiTracePropagationTargets } from "@/app/config/sentry/server";
import { sentrySharedOptions } from "@/app/config/sentry/shared";

/** proxy.ts runs here: its token refresh calls apps/server, so trace that too. */
export function initSentryEdge() {
  Sentry.init({
    ...sentrySharedOptions,
    tracePropagationTargets: apiTracePropagationTargets(),
    propagateTraceparent: true,
  });
}
