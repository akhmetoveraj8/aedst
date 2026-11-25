import type { Interceptor } from "@connectrpc/connect";

/**
 * How this client identifies itself to apps/server (ADR-0009,
 * docs/contract/behavior/client-version-gate.json): `<platform>/<semver>`.
 * The BFF (`/api/rpc`) sets it on every upstream call, overriding anything
 * the page sent, so the server's support-window gate sees one honest value.
 */
export const CLIENT_HEADER = "x-aedst-client";
/**
 * The web client's semver, equal to `version` in apps/web/shared/package.json
 * (client-id.test.ts fails when the two drift). A literal on purpose: importing
 * package.json here shipped the whole file, dependency list included, in a
 * client chunk, because the bundler does not tree-shake JSON.
 */
export const CLIENT_VERSION = "1.0.0";
export const CLIENT_ID = `web/${CLIENT_VERSION}`;

/** Connect interceptor for server-side clients: stamps CLIENT_ID on every call. */
export const clientIdInterceptor: Interceptor = (next) => async (request) => {
  request.header.set(CLIENT_HEADER, CLIENT_ID);
  return await next(request);
};
