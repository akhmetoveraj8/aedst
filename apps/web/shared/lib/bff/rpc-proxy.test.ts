import { describe, expect, it, vi } from "vitest";

import type { RefreshResult } from "@/shared/lib/auth/refresh-session";
import type { CookieWriter } from "@/shared/lib/auth/session-cookies";
import {
  applySessionCookieAction,
  isAllowedOrigin,
  proxyRpc,
  type RpcProxyConfig,
} from "@/shared/lib/bff/rpc-proxy";
import { fakeJwt } from "@/test/jwt";

// The framework-agnostic core; the app (Next) and admin (Hono) adapters have
// their own route tests on top of this.

const ORIGIN = "https://app.example";
const PROCEDURE = "aedst.tasks.v1.TasksService/ListTasks";

const tokens = {
  accessToken: "new-access",
  refreshToken: "new-refresh",
  accessMaxAgeSeconds: 600,
  refreshMaxAgeSeconds: 3600,
};

function setup(overrides: Partial<RpcProxyConfig> = {}) {
  const fetchMock = vi.fn<typeof fetch>(async () => new Response("{}"));
  const refreshSession = vi.fn<(token: string) => Promise<RefreshResult>>(
    async () => ({ status: "ok", tokens }),
  );
  const onUpstreamError = vi.fn();
  const config: RpcProxyConfig = {
    origin: ORIGIN,
    isAllowedProcedure: (procedure) => procedure === PROCEDURE,
    apiBaseUrl: "http://api.test",
    fetch: fetchMock,
    refreshSession,
    onUpstreamError,
    ...overrides,
  };
  return { config, fetchMock, refreshSession, onUpstreamError };
}

function request(headers: Record<string, string> = {}) {
  return new Request(`${ORIGIN}/api/rpc/${PROCEDURE}`, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json", ...headers },
    body: "{}",
  });
}

describe("isAllowedOrigin", () => {
  it("accepts only the configured origin, never the request's own Host", () => {
    expect(isAllowedOrigin(request(), ORIGIN)).toBe(true);
    expect(
      isAllowedOrigin(
        request({ origin: "https://evil.example", host: "evil.example" }),
        ORIGIN,
      ),
    ).toBe(false);
    expect(
      isAllowedOrigin(request({ "sec-fetch-site": "same-site" }), ORIGIN),
    ).toBe(false);
  });
});

describe("proxyRpc", () => {
  it("rejects an origin mismatch before any upstream or IdP call", async () => {
    const h = setup();
    const outcome = await proxyRpc(h.config, {
      request: request({ origin: "https://evil.example" }),
      procedure: PROCEDURE,
      accessToken: undefined,
      refreshToken: "rt",
    });
    expect(outcome.response.status).toBe(403);
    expect(outcome.cookies).toEqual({ kind: "keep" });
    expect(h.fetchMock).not.toHaveBeenCalled();
    expect(h.refreshSession).not.toHaveBeenCalled();
  });

  it("refuses a procedure outside the project's allowlist", async () => {
    const h = setup();
    const outcome = await proxyRpc(h.config, {
      request: request(),
      procedure: "aedst.admin.v1.AdminService/ListTasks",
      accessToken: fakeJwt({ expiresInSeconds: 600 }),
      refreshToken: undefined,
    });
    expect(outcome.response.status).toBe(404);
    expect(h.fetchMock).not.toHaveBeenCalled();
  });

  it("forwards with redirect: error so the bearer never follows a redirect", async () => {
    const h = setup();
    await proxyRpc(h.config, {
      request: request(),
      procedure: PROCEDURE,
      accessToken: fakeJwt({ expiresInSeconds: 600 }),
      refreshToken: undefined,
    });
    expect(h.fetchMock.mock.calls[0]?.[0]).toBe(`http://api.test/${PROCEDURE}`);
    expect(h.fetchMock.mock.calls[0]?.[1]?.redirect).toBe("error");
  });

  it("keeps the rotated tokens when apps/server is down right after the refresh", async () => {
    const h = setup();
    const failure = new TypeError("fetch failed");
    h.fetchMock.mockRejectedValue(failure);
    const outcome = await proxyRpc(h.config, {
      request: request(),
      procedure: PROCEDURE,
      accessToken: fakeJwt({ expiresInSeconds: -60 }),
      refreshToken: "old-refresh",
    });
    expect(outcome.response.status).toBe(503);
    expect(outcome.cookies).toEqual({ kind: "write", tokens });
    expect(h.onUpstreamError).toHaveBeenCalledWith(failure, PROCEDURE);
  });

  it("keeps the cookies untouched on an outage without a refresh", async () => {
    const h = setup();
    h.fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const outcome = await proxyRpc(h.config, {
      request: request(),
      procedure: PROCEDURE,
      accessToken: fakeJwt({ expiresInSeconds: 600 }),
      refreshToken: "rt",
    });
    expect(outcome.response.status).toBe(503);
    expect(outcome.cookies).toEqual({ kind: "keep" });
    expect(h.refreshSession).not.toHaveBeenCalled();
  });

  it("ends the session on a 401 when there is no refresh token", async () => {
    const h = setup();
    h.fetchMock.mockResolvedValue(new Response("{}", { status: 401 }));
    const outcome = await proxyRpc(h.config, {
      request: request(),
      procedure: PROCEDURE,
      accessToken: undefined,
      refreshToken: undefined,
    });
    expect(outcome.response.status).toBe(401);
    expect(outcome.cookies).toEqual({ kind: "clear" });
  });
});

describe("applySessionCookieAction", () => {
  it("writes, clears or leaves the session cookies", () => {
    const set = vi.fn<CookieWriter["set"]>();
    applySessionCookieAction({ set }, { kind: "keep" });
    expect(set).not.toHaveBeenCalled();
    applySessionCookieAction({ set }, { kind: "clear-access" });
    expect(set).toHaveBeenCalledTimes(1);
    applySessionCookieAction({ set }, { kind: "write", tokens });
    expect(set).toHaveBeenCalledTimes(3);
    applySessionCookieAction({ set }, { kind: "clear" });
    expect(set).toHaveBeenCalledTimes(6);
  });
});
