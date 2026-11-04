import "server-only";

import { createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";

import { clientIdInterceptor } from "@/shared/api/connect/client-id";
import { CapabilitiesService } from "@/shared/api/connect/generated/aedst/capabilities/v1/capabilities_pb";
import { serverEnv } from "@/shared/env/server";
import type { CapabilitySnapshot } from "@/shared/lib/capabilities/evaluate";
import { toSnapshot } from "@/shared/lib/capabilities/snapshot";

/**
 * Capabilities for server code (proxy.ts, the route guard). The answer does
 * not depend on the user and the server says it is safe to cache for a few
 * minutes, so each process asks at most once per TTL: a request never waits
 * on the network unless the cache is cold, concurrent callers share one
 * in-flight call, and a failure keeps serving the last known answer (then
 * `null`, i.e. the defaults) and is not retried for FAILURE_BACKOFF_MS.
 */
export const CAPABILITIES_TTL_MS = 60_000;
export const FAILURE_BACKOFF_MS = 10_000;
const FETCH_TIMEOUT_MS = 2_000;

let lastKnown: CapabilitySnapshot | null = null;
let validUntil = 0;
let inFlight: Promise<CapabilitySnapshot | null> | null = null;

const capabilitiesClient = createClient(
  CapabilitiesService,
  createConnectTransport({
    baseUrl: serverEnv.API_BASE_URL,
    defaultTimeoutMs: FETCH_TIMEOUT_MS,
    interceptors: [clientIdInterceptor],
    jsonOptions: { ignoreUnknownFields: true },
    // Resolved per call (not captured at module load) and never cached by
    // Next's data cache: the answer is cached here, with its own TTL.
    fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
  }),
);

async function fetchSnapshot(): Promise<CapabilitySnapshot> {
  return toSnapshot(await capabilitiesClient.getCapabilities({}));
}

export async function getServerCapabilities(
  now: number = Date.now(),
): Promise<CapabilitySnapshot | null> {
  if (now < validUntil) {
    return lastKnown;
  }
  inFlight ??= fetchSnapshot()
    .then((snapshot) => {
      lastKnown = snapshot;
      validUntil = Date.now() + CAPABILITIES_TTL_MS;
      return snapshot;
    })
    .catch(() => {
      validUntil = Date.now() + FAILURE_BACKOFF_MS;
      return lastKnown;
    })
    .finally(() => {
      inFlight = null;
    });
  return await inFlight;
}

/** Test seam: forget everything cached in this process. */
export function resetServerCapabilities(): void {
  lastKnown = null;
  validUntil = 0;
  inFlight = null;
}
