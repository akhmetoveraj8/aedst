import * as Sentry from "@sentry/nextjs";

import { sentrySharedOptions } from "@/app/config/sentry/shared";
import { clientEnv } from "@/shared/env/client";

// Re-exported for instrumentation-client.ts, which reaches the SDK only
// through this lazily imported module (see loader.ts).
export { captureRouterTransitionStart } from "@sentry/nextjs";

/**
 * The browser SDK. Nothing outside `loader.ts` may import this module
 * statically: it is the lazy chunk that keeps Sentry out of every route's
 * first load. Error and performance reporting is operational, so it starts
 * as soon as the chunk arrives (requested before hydration). Session Replay
 * is *behavioural recording*, so it is a further chunk that
 * `enableSessionReplay()` loads only after the visitor grants analytics
 * consent (see `ConsentLayer`): the privacy-correct default, and ~50 KB
 * gzipped off every page.
 */
export function initSentryClient() {
  if (Sentry.getClient()) {
    return;
  }
  Sentry.init({
    ...sentrySharedOptions,
    // Distributed tracing: the browser only talks to this app's same-origin
    // `/api/rpc` proxy, so that is the one outgoing target that gets trace
    // headers. The proxy forwards `traceparent`/`sentry-trace`/`baggage` to
    // apps/server, whose OpenTelemetry instrumentation continues the trace —
    // one trace from the click to the SQL. `propagateTraceparent` adds the
    // W3C header, which is what OpenTelemetry (not Sentry's format) reads.
    // Unanchored: Sentry matches it against the resolved absolute URL.
    tracePropagationTargets: [/\/api\/rpc\//],
    propagateTraceparent: true,
    replaysSessionSampleRate:
      clientEnv.NEXT_PUBLIC_SENTRY_REPLAY_SESSION_SAMPLE_RATE,
    replaysOnErrorSampleRate:
      clientEnv.NEXT_PUBLIC_SENTRY_REPLAY_ON_ERROR_SAMPLE_RATE,
  });
}

export async function enableSessionReplay() {
  const { addIntegration, getClient, replayIntegration } = await import(
    "@sentry/nextjs"
  );
  if (getClient() && !getClient()?.getIntegrationByName("Replay")) {
    addIntegration(
      replayIntegration({
        // Everything a user typed or read is masked, and media is blocked:
        // a replay shows *what happened*, not *what it said*.
        maskAllText: true,
        maskAllInputs: true,
        blockAllMedia: true,
        // Request/response bodies and headers are never recorded.
        networkDetailAllowUrls: [],
      }),
    );
  }
}

/** Consent withdrawn mid-session: stop recording now. */
export async function disableSessionReplay() {
  const { getReplay } = await import("@sentry/nextjs");
  await getReplay()?.stop();
}

/** An error caught before init (early-errors.ts), reported as uncaught. */
export function captureEarlyError(error: unknown) {
  Sentry.captureException(error, {
    mechanism: { type: "onerror", handled: false },
  });
}
