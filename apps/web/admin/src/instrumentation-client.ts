import * as Sentry from "@sentry/nextjs";

import { initSentryClient } from "@/app/config/sentry/client";

initSentryClient();

// Required by @sentry/nextjs to instrument App Router navigations.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
