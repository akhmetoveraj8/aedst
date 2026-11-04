import { Hono } from "hono";
import { getCookie } from "hono/cookie";

import { CLIENT_HEADER, CLIENT_ID } from "@/shared/api/connect/client-id";
import { isAccessTokenExpired } from "@/shared/lib/auth/session-claims";
import {
  ACCESS_COOKIE,
  clearAccessCookie,
  clearSessionCookies,
  REFRESH_COOKIE,
  type SessionTokens,
  writeSessionCookies,
} from "@/shared/lib/auth/session-cookies";
import { readBoundedBody } from "../http/read-bounded-body";
import {
  clientHeaders,
  HEADERS_TIMEOUT_MS,
  upstreamHeaders,
  withIdleTimeout,
} from "../http/upstream";
import { errorFields } from "../logger";
import { cookieJar } from "../session";
import type { AppBindings, AppDeps } from "../types";

/**
 * The browser's only door to apps/server: the page calls
 * `/api/rpc/<connect procedure>` same-origin, this handler attaches the bearer
 * token from the httpOnly cookie and transparently refreshes an expired
 * session once. Tokens never reach page JavaScript, and the browser needs no
 * CORS or cross-origin `connect-src`.
 */

const MAX_BODY_BYTES = 1_000_000;
const PREFIX = "/api/rpc/";

// Only the admin services (AdminService, capabilities); every other service
// belongs to the product app. There is no AuthService here: sign-in is OpenID
// Connect handled by /api/auth, and no token ever travels through this proxy
// in a response.
const ALLOWED_PROCEDURE =
  /^aedst\.(?:admin|capabilities)\.v1\.[A-Za-z]+Service\/[A-Za-z]+$/;

function connectError(status: number, code: string, message: string) {
  return Response.json(
    { code, message },
    { status, headers: { "cache-control": "no-store" } },
  );
}

export function rpcRoutes({ env, auth, logger, fetch: doFetch }: AppDeps) {
  const app = new Hono<AppBindings>();

  const sameOrigin = (request: Request): boolean => {
    const fetchSite = request.headers.get("sec-fetch-site");
    if (fetchSite === "cross-site" || fetchSite === "same-site") {
      return false;
    }
    // Only the configured origin counts: the request's own Host header is
    // attacker-controlled and says nothing about who sent the page.
    return request.headers.get("origin") === env.ADMIN_ORIGIN;
  };

  const forward = async (
    procedure: string,
    request: Request,
    body: ArrayBuffer,
    accessToken: string | undefined,
  ): Promise<Response> => {
    const headers = upstreamHeaders(request, {
      [CLIENT_HEADER]: CLIENT_ID,
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    });
    const controller = new AbortController();
    // A closed tab must not keep a (streaming) RPC open with the bearer attached.
    if (request.signal.aborted) {
      controller.abort();
    } else {
      request.signal.addEventListener("abort", () => controller.abort(), {
        once: true,
      });
    }
    const headersTimer = setTimeout(
      () => controller.abort(),
      HEADERS_TIMEOUT_MS,
    );
    try {
      const upstream = await doFetch(`${env.API_BASE_URL}/${procedure}`, {
        method: "POST",
        headers,
        body,
        cache: "no-store",
        // The bearer must never follow a redirect to another origin.
        redirect: "error",
        signal: controller.signal,
      });
      return withIdleTimeout(upstream, controller);
    } finally {
      clearTimeout(headersTimer);
    }
  };

  app.post("/*", async (c) => {
    const request = c.req.raw;
    if (!sameOrigin(request)) {
      return connectError(403, "permission_denied", "cross-origin request");
    }

    const procedure = c.req.path.slice(PREFIX.length);
    if (!ALLOWED_PROCEDURE.test(procedure)) {
      return connectError(404, "not_found", "unknown procedure");
    }

    const body = await readBoundedBody(request, MAX_BODY_BYTES);
    if (!body) {
      return connectError(413, "resource_exhausted", "request too large");
    }

    let accessToken = getCookie(c, ACCESS_COOKIE);
    const refreshToken = getCookie(c, REFRESH_COOKIE);
    let rotated: SessionTokens | null = null;
    let sessionEnded = false;
    let refreshStale = false;
    let refreshUnavailable = false;
    // At most one refresh per request (session-refresh.json): a failed
    // proactive refresh must not be repeated when the API then answers 401.
    let refreshAttempted = false;

    const rotate = async (): Promise<boolean> => {
      if (refreshAttempted) {
        return false;
      }
      refreshAttempted = true;
      if (!refreshToken) {
        sessionEnded = true;
        return false;
      }
      const result = await auth.refreshSession(refreshToken, {
        fetch: doFetch,
      });
      if (result.status === "ok") {
        rotated = result.tokens;
        accessToken = result.tokens.accessToken;
        return true;
      }
      sessionEnded = result.status === "rejected";
      refreshStale = result.status === "stale";
      refreshUnavailable = result.status === "unavailable";
      return false;
    };

    if (!accessToken || isAccessTokenExpired(accessToken)) {
      await rotate();
    }

    let upstream: Response;
    try {
      upstream = await forward(procedure, request, body, accessToken);
      if (upstream.status === 401 && !rotated && (await rotate())) {
        upstream = await forward(procedure, request, body, accessToken);
      }
    } catch (error) {
      logger.error("rpc.upstream_unavailable", {
        requestId: c.get("requestId"),
        procedure,
        ...errorFields(error),
      });
      // The refresh token was already rotated at the IdP: if the new pair is
      // not stored now, the next request presents a dead token and a transient
      // apps/server outage becomes a sign-out.
      if (rotated) {
        writeSessionCookies(cookieJar(c), rotated);
      }
      return c.newResponse(
        JSON.stringify({
          code: "unavailable",
          message: "upstream unavailable",
        }),
        {
          status: 503,
          headers: {
            "content-type": "application/json",
            "cache-control": "no-store",
          },
        },
      );
    }

    if (upstream.status === 401 && refreshUnavailable) {
      // The IdP is down, not the session: a retryable error, so the client
      // keeps the user signed in instead of treating this as a sign-out.
      return connectError(503, "unavailable", "session refresh unavailable");
    }

    const jar = cookieJar(c);
    if (upstream.status === 401 && sessionEnded) {
      clearSessionCookies(jar);
    } else if (upstream.status === 401 && refreshStale) {
      // The refresh token may merely have lost a rotation race to another
      // replica: drop the dead access token but keep the refresh cookie.
      clearAccessCookie(jar);
    } else if (rotated) {
      writeSessionCookies(jar, rotated);
    }
    return c.newResponse(upstream.body, {
      status: upstream.status as 200,
      headers: clientHeaders(upstream),
    });
  });

  return app;
}
