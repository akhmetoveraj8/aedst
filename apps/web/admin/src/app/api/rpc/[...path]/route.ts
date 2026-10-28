import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { readBoundedBody } from "@/app/api/rpc/read-bounded-body";

import { CLIENT_HEADER, CLIENT_ID } from "@/shared/api/connect/client-id";
import { clientEnv } from "@/shared/env/client";
import { serverEnv } from "@/shared/env/server";
import { refreshSession } from "@/shared/lib/auth/refresh-session";
import { isAccessTokenExpired } from "@/shared/lib/auth/session-claims";
import {
  ACCESS_COOKIE,
  clearAccessCookie,
  clearSessionCookies,
  REFRESH_COOKIE,
  type SessionTokens,
  writeSessionCookies,
} from "@/shared/lib/auth/session-cookies";
import { reportError } from "@/shared/lib/errors/report-error";

/**
 * The browser's only door to apps/server (backend-for-frontend): the page
 * calls `/api/rpc/<connect procedure>` same-origin, this handler attaches
 * the bearer token from the httpOnly cookie, and transparently refreshes an
 * expired session once. Tokens therefore never reach page JavaScript, and
 * the browser needs no CORS or cross-origin `connect-src`.
 */

const MAX_BODY_BYTES = 1_000_000;

// The upstream timeout bounds only the wait for response headers; once they
// arrive a stream (server-streaming RPC) may legitimately run for minutes, so
// from then on only silence between chunks is limited.
const HEADERS_TIMEOUT_MS = 15_000;
const STREAM_IDLE_TIMEOUT_MS = 60_000;

// Only the admin panel's services (AdminService, capabilities); every other
// service belongs to the product app. There is no AuthService here: sign-in is
// OpenID Connect handled by the app project, and no token ever travels
// through this proxy in a response.
const ALLOWED_PROCEDURE =
  /^aedst\.(?:admin|capabilities)\.v1\.[A-Za-z]+Service\/[A-Za-z]+$/;

const FORWARDED_REQUEST_HEADERS = [
  "content-type",
  "accept",
  "connect-protocol-version",
  "connect-timeout-ms",
  "idempotency-key",
  // Trace propagation, so a browser span and the server's spans join up.
  "traceparent",
  "tracestate",
  "sentry-trace",
  "baggage",
];

const DROPPED_RESPONSE_HEADERS = new Set([
  "content-encoding",
  "content-length",
  "transfer-encoding",
  "connection",
  "keep-alive",
  "set-cookie",
]);

function sameOrigin(request: Request): boolean {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site" || fetchSite === "same-site") {
    return false;
  }
  const origin = request.headers.get("origin");
  if (!origin) {
    return false;
  }
  try {
    const { host } = new URL(origin);
    return (
      origin === new URL(clientEnv.NEXT_PUBLIC_SITE_URL).origin ||
      host === request.headers.get("host")
    );
  } catch {
    return false;
  }
}

function connectError(status: number, code: string, message: string) {
  return Response.json(
    { code, message },
    { status, headers: { "cache-control": "no-store" } },
  );
}

async function forward(
  procedure: string,
  request: Request,
  body: ArrayBuffer,
  accessToken: string | undefined,
): Promise<Response> {
  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) {
      headers.set(name, value);
    }
  }
  headers.set(CLIENT_HEADER, CLIENT_ID);
  if (accessToken) {
    headers.set("authorization", `Bearer ${accessToken}`);
  }
  const controller = new AbortController();
  const headersTimer = setTimeout(() => controller.abort(), HEADERS_TIMEOUT_MS);
  let upstream: Response;
  try {
    upstream = await fetch(`${serverEnv.API_BASE_URL}/${procedure}`, {
      method: "POST",
      headers,
      body,
      cache: "no-store",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(headersTimer);
  }
  return withIdleTimeout(upstream, controller);
}

/** Re-wraps the body so a stalled upstream is aborted after the idle limit. */
function withIdleTimeout(
  upstream: Response,
  controller: AbortController,
): Response {
  if (!upstream.body) {
    return upstream;
  }
  const reader = upstream.body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let sink: ReadableStreamDefaultController<Uint8Array> | undefined;
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      controller.abort();
      sink?.error(new Error("upstream stream idle"));
    }, STREAM_IDLE_TIMEOUT_MS);
  };
  arm();
  const body = new ReadableStream<Uint8Array>({
    start(out) {
      sink = out;
    },
    async pull(out) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          clearTimeout(timer);
          out.close();
          return;
        }
        arm();
        out.enqueue(value);
      } catch (error) {
        clearTimeout(timer);
        out.error(error);
      }
    },
    async cancel(reason) {
      clearTimeout(timer);
      await reader.cancel(reason);
    },
  });
  return new Response(body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: upstream.headers,
  });
}

function toClientResponse(upstream: Response): NextResponse {
  const headers = new Headers();
  upstream.headers.forEach((value, name) => {
    if (!DROPPED_RESPONSE_HEADERS.has(name)) {
      headers.set(name, value);
    }
  });
  headers.set("cache-control", "no-store");
  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers,
  });
}

export async function POST(
  request: Request,
  { params }: RouteContext<"/api/rpc/[...path]">,
): Promise<Response> {
  if (!sameOrigin(request)) {
    return connectError(403, "permission_denied", "cross-origin request");
  }

  const procedure = (await params).path.join("/");
  if (!ALLOWED_PROCEDURE.test(procedure)) {
    return connectError(404, "not_found", "unknown procedure");
  }

  const body = await readBoundedBody(request, MAX_BODY_BYTES);
  if (!body) {
    return connectError(413, "resource_exhausted", "request too large");
  }

  const jar = await cookies();
  let accessToken = jar.get(ACCESS_COOKIE)?.value;
  const refreshToken = jar.get(REFRESH_COOKIE)?.value;
  let rotated: SessionTokens | null = null;
  let sessionEnded = false;
  let refreshStale = false;
  let refreshUnavailable = false;
  // At most one refresh per request (session-refresh.json): a failed
  // proactive refresh must not be repeated when the API then answers 401.
  let refreshAttempted = false;

  async function rotate(): Promise<boolean> {
    if (refreshAttempted) {
      return false;
    }
    refreshAttempted = true;
    if (!refreshToken) {
      sessionEnded = true;
      return false;
    }
    const result = await refreshSession(refreshToken);
    if (result.status === "ok") {
      rotated = result.tokens;
      accessToken = result.tokens.accessToken;
      return true;
    }
    sessionEnded = result.status === "rejected";
    refreshStale = result.status === "stale";
    refreshUnavailable = result.status === "unavailable";
    return false;
  }

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
    reportError(error, { source: "bff", procedure });
    return connectError(503, "unavailable", "upstream unavailable");
  }

  if (upstream.status === 401 && refreshUnavailable) {
    // The IdP is down, not the session: a retryable error, so the client
    // keeps the user signed in instead of treating this as a sign-out.
    return connectError(503, "unavailable", "session refresh unavailable");
  }

  const response = toClientResponse(upstream);
  if (upstream.status === 401 && sessionEnded) {
    clearSessionCookies(response.cookies);
  } else if (upstream.status === 401 && refreshStale) {
    // The refresh token may merely have lost a rotation race to another
    // replica: drop the dead access token but keep the refresh cookie.
    clearAccessCookie(response.cookies);
  } else if (rotated) {
    writeSessionCookies(response.cookies, rotated);
  }
  return response;
}
