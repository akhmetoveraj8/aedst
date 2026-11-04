import type * as SentryClient from "@/app/config/sentry/client";

/**
 * The one door to the lazily loaded browser SDK (`client.ts`): a static
 * import of that module anywhere in the page would put the whole SDK back
 * into the first load. The first call requests the chunk and initialises
 * Sentry; every later call shares that promise. `null` when the chunk could
 * not be loaded (offline, a deploy in between): the page works without
 * monitoring, and the failure itself is not an unhandled rejection.
 */
let ready: Promise<typeof SentryClient | null> | undefined;

export function loadSentry(): Promise<typeof SentryClient | null> {
  ready ??= import("@/app/config/sentry/client")
    .then((client) => {
      client.initSentryClient();
      return client;
    })
    .catch(() => null);
  return ready;
}

/** Consent granted: start Session Replay once the SDK is up. */
export async function enableSessionReplay(): Promise<void> {
  await (await loadSentry())?.enableSessionReplay();
}

/** Consent withdrawn mid-session: stop recording now. */
export async function disableSessionReplay(): Promise<void> {
  await (await loadSentry())?.disableSessionReplay();
}
