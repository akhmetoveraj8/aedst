import { describe, expect, it } from "vitest";

import { OidcConfigError } from "@/shared/lib/auth/oidc/config";
import { PRE_AUTH_COOKIE } from "@/shared/lib/auth/oidc/pre-auth-cookie";
import {
  ACCESS_COOKIE,
  cookieHeader,
  ID_COOKIE,
  makeHarness,
  ORIGIN,
  REFRESH_COOKIE,
  setCookies,
} from "../test/harness";
import { idToken, tokenWithRoles } from "../test/jwt";

describe("GET /api/auth/login", () => {
  it("redirects to the IdP and seals the pre-auth cookie (httpOnly, lax, no-store)", async () => {
    const { app, auth } = makeHarness();
    auth.startLogin.mockResolvedValue({
      location: "http://localhost:8085/authorize?x=1",
      sealed: "sealed-value",
    });
    const response = await app.request("/api/auth/login?next=/en/admin/tasks");
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "http://localhost:8085/authorize?x=1",
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${PRE_AUTH_COOKIE}=sealed-value`);
    expect(cookie).toMatch(/httponly/i);
    expect(cookie).toMatch(/samesite=lax/i);
    expect(cookie).toMatch(/path=\//i);
    expect(auth.startLogin).toHaveBeenCalledWith(
      expect.objectContaining({ next: "/en/admin/tasks", register: false }),
    );
  });

  it("hands an unsafe next to startLogin, which refuses it (open-redirect guard)", async () => {
    // The real validator lives in shared/lib/auth/safe-redirect; this proves
    // the raw value reaches it unchanged and the redirect target is the IdP's.
    const { app, auth } = makeHarness();
    auth.startLogin.mockResolvedValue({
      location: "http://idp/a",
      sealed: "s",
    });
    const response = await app.request("/api/auth/login?next=//evil.example");
    expect(response.headers.get("location")).toBe("http://idp/a");
    expect(auth.startLogin).toHaveBeenCalledWith(
      expect.objectContaining({ next: "//evil.example" }),
    );
  });

  it("lands on the locale-less /forbidden with auth_error=unavailable on an IdP failure", async () => {
    const { app, auth } = makeHarness();
    auth.startLogin.mockRejectedValue(new Error("discovery failed"));
    const response = await app.request("/api/auth/login", {});
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.origin).toBe(ORIGIN);
    expect(location.pathname).toBe("/forbidden");
    expect(location.searchParams.get("auth_error")).toBe("unavailable");
  });

  it("maps a misconfiguration to auth_error=config", async () => {
    const { app, auth } = makeHarness();
    auth.startLogin.mockRejectedValue(new OidcConfigError("missing issuer"));
    const response = await app.request("/api/auth/login");
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.pathname).toBe("/forbidden");
    expect(location.searchParams.get("auth_error")).toBe("config");
  });
});

describe("GET /api/auth/callback", () => {
  const tokens = {
    accessToken: "a.b.c",
    refreshToken: "refresh",
    accessMaxAgeSeconds: 600,
    refreshMaxAgeSeconds: 3600,
    idToken: "id",
  };

  it("stores the session cookies, clears the pre-auth cookie and redirects to next", async () => {
    const { app, auth } = makeHarness();
    auth.completeLogin.mockResolvedValue({
      ok: true,
      tokens,
      next: "/en/admin",
    });
    const response = await app.request("/api/auth/callback?code=c&state=s", {
      headers: { cookie: cookieHeader({ [PRE_AUTH_COOKIE]: "sealed" }) },
    });
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`${ORIGIN}/en/admin`);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const { raw, values } = setCookies(response);
    expect(values[ACCESS_COOKIE]).toBe("a.b.c");
    expect(values[REFRESH_COOKIE]).toBe("refresh");
    expect(values[ID_COOKIE]).toBe("id");
    expect(values[PRE_AUTH_COOKIE]).toBe("");
    expect(raw.find((l) => l.startsWith(PRE_AUTH_COOKIE))).toMatch(
      /Max-Age=0/i,
    );
    const call = auth.completeLogin.mock.calls[0]?.[0];
    expect(call?.sealed).toBe("sealed");
    // The callback URL is rebuilt on the public origin with the IdP's query.
    expect(call?.callbackUrl.href).toBe(
      `${ORIGIN}/api/auth/callback?code=c&state=s`,
    );
  });

  it("lands on the locale-less /forbidden with the coarse reason on a failed login, no session", async () => {
    const { app, auth } = makeHarness();
    auth.completeLogin.mockResolvedValue({ ok: false, reason: "denied" });
    const response = await app.request(
      "/api/auth/callback?error=access_denied",
    );
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.pathname).toBe("/forbidden");
    expect(location.searchParams.get("auth_error")).toBe("denied");
    const { values } = setCookies(response);
    expect(values[ACCESS_COOKIE]).toBeUndefined();
    expect(values[PRE_AUTH_COOKIE]).toBe("");
  });

  it("reports an unexpected failure as unavailable (config for OidcConfigError)", async () => {
    const { app, auth } = makeHarness();
    auth.completeLogin.mockRejectedValue(new Error("boom"));
    let location = new URL(
      (await app.request("/api/auth/callback")).headers.get("location") ?? "",
    );
    expect(location.searchParams.get("auth_error")).toBe("unavailable");
    auth.completeLogin.mockRejectedValue(new OidcConfigError("x"));
    location = new URL(
      (await app.request("/api/auth/callback")).headers.get("location") ?? "",
    );
    expect(location.searchParams.get("auth_error")).toBe("config");
  });
});

describe("GET /api/auth/session", () => {
  it("answers 401 {authenticated:false}, uncached, for an anonymous visitor", async () => {
    const { app } = makeHarness();
    const response = await app.request("/api/auth/session");
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ authenticated: false });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("answers identity and roles, never a token", async () => {
    const { app } = makeHarness();
    const access = tokenWithRoles(["admin", "support"]);
    const response = await app.request("/api/auth/session", {
      headers: {
        cookie: cookieHeader({
          [ACCESS_COOKIE]: access,
          [REFRESH_COOKIE]: "r",
          [ID_COOKIE]: idToken({ email: "a@example.com", name: "Ada" }),
        }),
      },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({
      authenticated: true,
      email: "a@example.com",
      name: "Ada",
      sub: "user-1",
      roles: ["admin", "support"],
    });
    expect(text).not.toContain(access);
    expect(text).not.toContain('"r"');
  });

  it("rotates an expired session and returns the fresh identity", async () => {
    const { app, auth } = makeHarness();
    auth.refreshSession.mockResolvedValue({
      status: "ok",
      tokens: {
        accessToken: tokenWithRoles(["auditor"]),
        refreshToken: "new",
        accessMaxAgeSeconds: 600,
        refreshMaxAgeSeconds: 3600,
        idToken: idToken({ email: "b@example.com" }),
      },
    });
    const response = await app.request("/api/auth/session", {
      headers: {
        cookie: cookieHeader({
          [ACCESS_COOKIE]: tokenWithRoles(["auditor"], -100),
          [REFRESH_COOKIE]: "old",
        }),
      },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      authenticated: true,
      email: "b@example.com",
      sub: "user-1",
      roles: ["auditor"],
    });
    expect(setCookies(response).values[REFRESH_COOKIE]).toBe("new");
  });

  it("answers 401 and clears the cookies when the refresh token is rejected", async () => {
    const { app, auth } = makeHarness();
    auth.refreshSession.mockResolvedValue({ status: "rejected" });
    const response = await app.request("/api/auth/session", {
      headers: { cookie: cookieHeader({ [REFRESH_COOKIE]: "dead" }) },
    });
    expect(response.status).toBe(401);
    expect(
      setCookies(response).raw.filter((l) => /Max-Age=0/i.test(l)),
    ).toHaveLength(3);
  });

  it("answers a retryable 503 (session kept) while the IdP is down", async () => {
    const { app, auth } = makeHarness();
    auth.refreshSession.mockResolvedValue({ status: "unavailable" });
    const response = await app.request("/api/auth/session", {
      headers: { cookie: cookieHeader({ [REFRESH_COOKIE]: "r" }) },
    });
    expect(response.status).toBe(503);
    expect(setCookies(response).raw).toEqual([]);
  });
});

describe("POST /api/auth/logout", () => {
  const cookies = {
    [ACCESS_COOKIE]: tokenWithRoles(["admin"]),
    [REFRESH_COOKIE]: "refresh",
    [ID_COOKIE]: "id-token",
  };
  const post = (
    app: ReturnType<typeof makeHarness>["app"],
    headers: Record<string, string>,
  ) =>
    app.request("/api/auth/logout", {
      method: "POST",
      headers: { cookie: cookieHeader(cookies), ...headers },
    });

  it("refuses a request without x-requested-with (CSRF guard) and touches nothing", async () => {
    const h = makeHarness();
    const response = await post(h.app, {});
    expect(response.status).toBe(403);
    expect(setCookies(response).raw).toEqual([]);
    expect(h.auth.revokeRefreshToken).not.toHaveBeenCalled();
  });

  it("refuses a browser-declared cross-site request even with the header", async () => {
    for (const site of ["cross-site", "same-site"]) {
      const h = makeHarness();
      const response = await post(h.app, {
        "x-requested-with": "fetch",
        "sec-fetch-site": site,
      });
      expect(response.status).toBe(403);
      expect(setCookies(response).raw).toEqual([]);
      expect(h.auth.revokeRefreshToken).not.toHaveBeenCalled();
    }
  });

  it("clears the cookies, revokes the refresh token and returns the end-session URL", async () => {
    const h = makeHarness();
    h.auth.buildEndSessionUrl.mockResolvedValue(
      "https://idp.example/logout?x=1",
    );
    const response = await post(h.app, { "x-requested-with": "fetch" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      endSessionUrl: "https://idp.example/logout?x=1",
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(
      setCookies(response).raw.filter((l) => /Max-Age=0/i.test(l)),
    ).toHaveLength(3);
    expect(h.auth.revokeRefreshToken).toHaveBeenCalledWith(
      expect.objectContaining({ refreshToken: "refresh" }),
    );
    expect(h.auth.buildEndSessionUrl).toHaveBeenCalledWith(
      expect.objectContaining({ idToken: "id-token" }),
    );
  });

  it("still signs out locally (endSessionUrl null) when the IdP config or calls fail", async () => {
    const h = makeHarness();
    h.auth.getOidcConfig.mockImplementation(() => {
      throw new OidcConfigError("missing issuer");
    });
    const response = await post(h.app, { "x-requested-with": "fetch" });
    expect(await response.json()).toEqual({ endSessionUrl: null });
    expect(
      setCookies(response).raw.filter((l) => /Max-Age=0/i.test(l)),
    ).toHaveLength(3);
  });
});
