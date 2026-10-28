import * as Sentry from "@sentry/nextjs";

import { sentrySharedOptions } from "@/app/config/sentry/shared";
import { clientEnv } from "@/shared/env/client";

/**
 * Error and performance reporting is operational, so it starts immediately.
 * Session Replay is *behavioural recording*, so it is not part of this
 * initial bundle at all: `enableSessionReplay()` loads it only after the
 * visitor grants analytics consent (see `ConsentLayer`). That is both the
 * privacy-correct default and ~50 KB gzipped off every first load.
 */
export function initSentryClient() {
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
