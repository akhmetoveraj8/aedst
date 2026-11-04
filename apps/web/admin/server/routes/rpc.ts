import { Hono } from "hono";
import { getCookie } from "hono/cookie";

import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
} from "@/shared/lib/auth/session-cookies";
import { applySessionCookieAction, proxyRpc } from "@/shared/lib/bff/rpc-proxy";
import { errorFields } from "../logger";
import { cookieJar } from "../session";
import type { AppBindings, AppDeps } from "../types";

/**
 * The browser's only door to apps/server. The whole proxy (origin check,
 * allowlist, bounded body, forwarding, session refresh) is
 * `shared/lib/bff/rpc-proxy.ts`, shared with the product app's BFF; this file
 * only adapts it to Hono's cookies and responses.
 */

const PREFIX = "/api/rpc/";

// Only the admin services (AdminService, capabilities); every other service
// belongs to the product app. There is no AuthService here: sign-in is OpenID
// Connect handled by /api/auth, and no token ever travels through this proxy
// in a response.
const ALLOWED_PROCEDURE =
  /^aedst\.(?:admin|capabilities)\.v1\.[A-Za-z]+Service\/[A-Za-z]+$/;

export function rpcRoutes({ env, auth, logger, fetch: doFetch }: AppDeps) {
  const app = new Hono<AppBindings>();

  app.post("/*", async (c) => {
    const { response, cookies } = await proxyRpc(
      {
        origin: env.ADMIN_ORIGIN,
        isAllowedProcedure: (procedure) => ALLOWED_PROCEDURE.test(procedure),
        apiBaseUrl: env.API_BASE_URL,
        fetch: doFetch,
        refreshSession: (refreshToken) =>
          auth.refreshSession(refreshToken, { fetch: doFetch }),
        onUpstreamError: (error, procedure) =>
          logger.error("rpc.upstream_unavailable", {
            requestId: c.get("requestId"),
            procedure,
            ...errorFields(error),
          }),
      },
      {
        request: c.req.raw,
        procedure: c.req.path.slice(PREFIX.length),
        accessToken: getCookie(c, ACCESS_COOKIE),
        refreshToken: getCookie(c, REFRESH_COOKIE),
      },
    );
    applySessionCookieAction(cookieJar(c), cookies);
    return c.newResponse(response.body, {
      status: response.status as 200,
      headers: response.headers,
    });
  });

  return app;
}
