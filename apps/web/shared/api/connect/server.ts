import "server-only";

import type { Interceptor } from "@connectrpc/connect";
import { addStaticKeyToTransport } from "@connectrpc/connect-query";
import { createConnectTransport } from "@connectrpc/connect-web";
import { TRANSPORT_STATIC_KEY } from "@/shared/api/connect/transport-key";
import { serverEnv } from "@/shared/env/server";
import { getAccessToken } from "@/shared/lib/auth/session";

const SERVER_TIMEOUT_MS = 8_000;

function createBaseTransport(interceptors: Interceptor[] = []) {
  return createConnectTransport({
    baseUrl: serverEnv.API_BASE_URL,
    defaultTimeoutMs: SERVER_TIMEOUT_MS,
    interceptors,
  });
}

const bearerFromSession: Interceptor = (next) => async (req) => {
  const token = await getAccessToken();
  if (token) {
    req.header.set("Authorization", `Bearer ${token}`);
  }
  return await next(req);
};

/**
 * Server-side transport for Server Components: calls apps/server directly
 * (API_BASE_URL, an internal address in production) with the caller's
 * access token read from the httpOnly session cookie. The static key makes
 * queries prefetched here share cache keys with the browser transport, so
 * `HydrationBoundary` data is actually found by the client's `useQuery`.
 */
export function getServerTransport() {
  return addStaticKeyToTransport(
    createBaseTransport([bearerFromSession]),
    TRANSPORT_STATIC_KEY,
  );
}
