import * as Sentry from "@sentry/nextjs";
import { sentrySharedOptions } from "@/app/config/sentry/shared";
import { edgeEnv } from "@/shared/env/edge";

/**
 * Server-side, the outgoing calls that matter are this app's calls to
 * apps/server (`API_BASE_URL`: Server Components, Server Actions and the
 * `/api/rpc` BFF). Trace headers go there — and only there, never to
 * third parties — so the Go server's OpenTelemetry spans join the same
 * trace as the Next.js request that caused them.
 */
export function apiTracePropagationTargets(
  apiBaseUrl = edgeEnv.API_BASE_URL,
): (string | RegExp)[] {
  try {
    return [new URL(apiBaseUrl).origin];
  } catch {
    return [];
  }
}

export function initSentryServer() {
  Sentry.init({
    ...sentrySharedOptions,
    tracePropagationTargets: apiTracePropagationTargets(),
    propagateTraceparent: true,
  });
}
