import type { Interceptor } from "@connectrpc/connect";

import { version } from "../../package.json";

/**
 * How this client identifies itself to apps/server (ADR-0009,
 * docs/contract/behavior/client-version-gate.json): `<platform>/<semver>`.
 * The BFF (`/api/rpc`) sets it on every upstream call, overriding anything
 * the page sent, so the server's support-window gate sees one honest value.
 */
export const CLIENT_HEADER = "x-aedst-client";
export const CLIENT_VERSION = version;
export const CLIENT_ID = `web/${CLIENT_VERSION}`;

/** Connect interceptor for server-side clients: stamps CLIENT_ID on every call. */
export const clientIdInterceptor: Interceptor = (next) => async (request) => {
  request.header.set(CLIENT_HEADER, CLIENT_ID);
  return await next(request);
};
