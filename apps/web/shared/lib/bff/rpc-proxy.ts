import "server-only";

import type { RefreshResult } from "@/shared/lib/auth/refresh-session";
import { isAccessTokenExpired } from "@/shared/lib/auth/session-claims";
import {
  type CookieWriter,
  clearAccessCookie,
  clearSessionCookies,
  type SessionTokens,
  writeSessionCookies,
} from "@/shared/lib/auth/session-cookies";
import { readBoundedBody } from "@/shared/lib/bff/read-bounded-body";
import { clientHeaders, forwardUpstream } from "@/shared/lib/bff/upstream";

/**
 * The framework-agnostic core of the `/api/rpc` backend-for-frontend shared by
 * `app` (a Next.js route handler) and `admin` (a Hono route): the page calls
 * `/api/rpc/<connect procedure>` same-origin, the proxy attaches the bearer
 * token from the httpOnly cookie and transparently refreshes an expired
 * session once. Tokens never reach page JavaScript, and the browser needs no
 * CORS or cross-origin `connect-src`.
 *
 * Cookies are the one framework-specific part: the core returns what to do
 * with them (`SessionCookieAction`) and each adapter applies it with
 * `applySessionCookieAction` to its own cookie API.
 */

const MAX_BODY_BYTES = 1_000_000;

export type RpcProxyConfig = {
  /** The project's public origin: the only `Origin` allowed to call. */
  origin: string;
  /** The project's own services; anything else is a 404 before any I/O. */
  isAllowedProcedure: (procedure: string) => boolean;
  apiBaseUrl: string;
  refreshSession: (refreshToken: string) => Promise<RefreshResult>;
  /** apps/server could not be reached (logging / Sentry). */
  onUpstreamError: (error: unknown, procedure: string) => void;
  /** Defaults to the global `fetch`, read per call. */
  fetch?: typeof fetch;
};

export type RpcProxyRequest = {
  request: Request;
  /** The path after `/api/rpc/`. */
  procedure: string;
  accessToken: string | undefined;
  refreshToken: string | undefined;
};

/** What the adapter must do to the session cookies of the response. */
export type SessionCookieAction =
  | { kind: "keep" }
  | { kind: "write"; tokens: SessionTokens }
  | { kind: "clear" }
  | { kind: "clear-access" };

export type RpcProxyOutcome = {
  response: Response;
  cookies: SessionCookieAction;
};

const KEEP: SessionCookieAction = { kind: "keep" };

export function applySessionCookieAction(
  jar: CookieWriter,
  action: SessionCookieAction,
): void {
  switch (action.kind) {
    case "write":
      writeSessionCookies(jar, action.tokens);
      return;
    case "clear":
      clearSessionCookies(jar);
      return;
    case "clear-access":
      clearAccessCookie(jar);
      return;
    case "keep":
      return;
  }
}

/**
 * CSRF guard. Only the configured origin counts: the request's own Host
 * header is attacker-controlled and says nothing about who sent the page.
 */
export function isAllowedOrigin(request: Request, origin: string): boolean {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site" || fetchSite === "same-site") {
    return false;
  }
  return request.headers.get("origin") === new URL(origin).origin;
}

function connectError(status: number, code: string, message: string) {
  return Response.json(
    { code, message },
    { status, headers: { "cache-control": "no-store" } },
  );
}

const rejected = (status: number, code: string, message: string) => ({
  response: connectError(status, code, message),
  cookies: KEEP,
});

export async function proxyRpc(
  config: RpcProxyConfig,
  input: RpcProxyRequest,
): Promise<RpcProxyOutcome> {
  const { request, procedure } = input;
  if (!isAllowedOrigin(request, config.origin)) {
    return rejected(403, "permission_denied", "cross-origin request");
  }
  if (!config.isAllowedProcedure(procedure)) {
    return rejected(404, "not_found", "unknown procedure");
  }
  const body = await readBoundedBody(request, MAX_BODY_BYTES);
  if (!body) {
    return rejected(413, "resource_exhausted", "request too large");
  }

  const session: SessionState = {
    accessToken: input.accessToken,
    rotated: null,
    refresh: undefined,
  };

  // At most one refresh per request (session-refresh.json): a failed
  // proactive refresh must not be repeated when the API then answers 401.
  const rotate = async (): Promise<boolean> => {
    if (session.refresh) {
      return false;
    }
    if (!input.refreshToken) {
      session.refresh = "no-token";
      return false;
    }
    const result = await config.refreshSession(input.refreshToken);
    session.refresh = result.status;
    if (result.status !== "ok") {
      return false;
    }
    session.rotated = result.tokens;
    session.accessToken = result.tokens.accessToken;
    return true;
  };

  const doFetch = config.fetch ?? fetch;
  const forward = () =>
    forwardUpstream({
      fetch: doFetch,
      url: `${config.apiBaseUrl}/${procedure}`,
      request,
      body,
      accessToken: session.accessToken,
    });

  if (!session.accessToken || isAccessTokenExpired(session.accessToken)) {
    await rotate();
  }

  let upstream: Response;
  try {
    upstream = await forward();
    if (upstream.status === 401 && !session.rotated && (await rotate())) {
      await discard(upstream);
      upstream = await forward();
    }
  } catch (error) {
    config.onUpstreamError(error, procedure);
    // The refresh token was already rotated at the IdP: if the new pair is
    // not stored now, the next request presents a dead token and a transient
    // apps/server outage becomes a sign-out.
    return {
      response: connectError(503, "unavailable", "upstream unavailable"),
      cookies: session.rotated
        ? { kind: "write", tokens: session.rotated }
        : KEEP,
    };
  }

  if (upstream.status === 401 && session.refresh === "unavailable") {
    // The IdP is down, not the session: a retryable error, so the client
    // keeps the user signed in instead of treating this as a sign-out.
    await discard(upstream);
    return rejected(503, "unavailable", "session refresh unavailable");
  }

  const response = new Response(upstream.body, {
    status: upstream.status,
    headers: clientHeaders(upstream),
  });
  return { response, cookies: cookieAction(upstream.status, session) };
}

type SessionState = {
  accessToken: string | undefined;
  rotated: SessionTokens | null;
  /** The outcome of this request's one refresh, if it made one. */
  refresh: RefreshResult["status"] | "no-token" | undefined;
};

/** Releases an upstream body we will not relay; its errors do not matter. */
async function discard(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => {});
}

function cookieAction(
  status: number,
  { refresh, rotated }: SessionState,
): SessionCookieAction {
  if (status === 401 && (refresh === "rejected" || refresh === "no-token")) {
    return { kind: "clear" };
  }
  if (status === 401 && refresh === "stale") {
    // The refresh token may merely have lost a rotation race to another
    // replica: drop the dead access token but keep the refresh cookie.
    return { kind: "clear-access" };
  }
  return rotated ? { kind: "write", tokens: rotated } : KEEP;
}
