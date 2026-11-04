// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { refreshSession } from "@/shared/lib/auth/refresh-session";
import { getServerCapabilities } from "@/shared/lib/capabilities/server";
import { fakeJwt } from "@/test/jwt";
import proxy from "./proxy";

// The refresh grant itself is covered by refresh-session.test.ts; here only
// what the proxy does with each outcome matters.
vi.mock("@/shared/lib/auth/refresh-session", () => ({
  refreshSession: vi.fn(),
}));

vi.mock("@/shared/lib/capabilities/server", () => ({
  getServerCapabilities: vi.fn(async () => null),
}));

const ACCESS = "aedst_session";
const REFRESH = "aedst_session_refresh";

function request(path: string, cookies: Record<string, string> = {}) {
  const cookie = Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
  return new NextRequest(`http://localhost:3000${path}`, {
    headers: cookie ? { cookie } : {},
  });
}

const rotated = () => ({
  status: "ok" as const,
  tokens: {
    accessToken: fakeJwt({ sub: "rotated", expiresInSeconds: 900 }),
    refreshToken: "rotated-refresh",
    accessMaxAgeSeconds: 900,
    refreshMaxAgeSeconds: 86_400,
  },
});

// next-intl also sets its own NEXT_LOCALE cookie; these tests are about the session ones.
const sessionCookies = (response: Response) =>
  response.headers
    .getSetCookie()
    .filter((cookie) => cookie.startsWith("aedst_session"));

let refreshCounter = 0;
const freshRefreshToken = () => `rt-proxy-${++refreshCounter}`;

beforeEach(() => {
  refreshCounter += 100;
});

describe("proxy: content security policy", () => {
  it("issues a fresh nonce per request and exposes it to the render", async () => {
    const first = await proxy(request("/en"));
    const second = await proxy(request("/en"));

    const csp = first.headers.get("content-security-policy") ?? "";
    const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
    expect(nonce).toBeTruthy();
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(nonce).not.toBe(
      /'nonce-([^']+)'/.exec(
        second.headers.get("content-security-policy") ?? "",
      )?.[1],
    );

    // The request headers Next.js renders with must carry the nonce/CSP, or
    // it cannot stamp the nonce onto its scripts.
    expect(first.headers.get("x-middleware-request-x-nonce")).toBe(nonce);
    expect(
      first.headers.get("x-middleware-request-content-security-policy"),
    ).toBe(csp);
  });
});

describe("proxy: single Content-Security-Policy source", () => {
  it.each([
    ["/en", /script-src[^;]*'nonce-/],
    ["/api/rpc/aedst.tasks.v1.TaskService/List", /^default-src 'none'/],
    ["/serwist/sw.js", /^default-src 'self'; script-src 'self'$/],
  ])("emits exactly one enforced CSP header for %s", async (path, expected) => {
    const response = await proxy(request(path));

    const policies = [...response.headers.entries()].filter(
      ([name]) => name === "content-security-policy",
    );
    expect(policies).toHaveLength(1);
    expect(policies[0]?.[1]).toMatch(expected);
  });

  it("does not run session refresh or locale routing for /api and /serwist", async () => {
    const response = await proxy(
      request("/api/rpc/x", { [REFRESH]: freshRefreshToken() }),
    );

    expect(refreshSession).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBeNull();
  });
});

describe("proxy: route protection", () => {
  it("redirects an anonymous visitor from a protected page, keeping the destination", async () => {
    const response = await proxy(request("/en/tasks?status=done"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      `http://localhost:3000/en?next=${encodeURIComponent("/tasks?status=done")}`,
    );
  });

  it("lets an anonymous visitor see the login page", async () => {
    const response = await proxy(request("/en"));
    expect(response.headers.get("location")).toBeNull();
  });

  it("sends a signed-in visitor from the login page to the dashboard", async () => {
    const response = await proxy(
      request("/en", { [ACCESS]: fakeJwt({ expiresInSeconds: 600 }) }),
    );

    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/en/tasks",
    );
  });

  it("lets a signed-in visitor through to protected pages", async () => {
    const response = await proxy(
      request("/en/tasks", { [ACCESS]: fakeJwt({ expiresInSeconds: 600 }) }),
    );

    expect(response.headers.get("location")).toBeNull();
    expect(sessionCookies(response)).toEqual([]);
  });

  it("negotiates the locale for a bare path (next-intl still runs)", async () => {
    const response = await proxy(request("/"));
    expect(response.headers.get("location")).toMatch(/\/en$/);
  });
});

describe("proxy: session refresh", () => {
  it("renews an expired access token, sets the cookies and hands the fresh token to the render", async () => {
    const refreshToken = freshRefreshToken();
    vi.mocked(refreshSession).mockResolvedValue(rotated());

    const response = await proxy(
      request("/en/tasks", {
        [ACCESS]: fakeJwt({ expiresInSeconds: -60 }),
        [REFRESH]: refreshToken,
      }),
    );

    expect(response.headers.get("location")).toBeNull();
    const setCookies = sessionCookies(response);
    expect(setCookies.some((c) => c.startsWith(`${ACCESS}=`))).toBe(true);
    expect(
      setCookies.some((c) => c.startsWith(`${REFRESH}=rotated-refresh`)),
    ).toBe(true);
    for (const cookie of setCookies) {
      expect(cookie).toMatch(/HttpOnly/i);
    }
    // Server Components in this same request must see the new token.
    expect(response.headers.get("x-middleware-request-cookie")).toContain(
      `${REFRESH}=rotated-refresh`,
    );
  });

  it("renews when only the refresh cookie is left", async () => {
    vi.mocked(refreshSession).mockResolvedValue(rotated());

    const response = await proxy(
      request("/en/tasks", { [REFRESH]: freshRefreshToken() }),
    );

    expect(response.headers.get("location")).toBeNull();
    expect(sessionCookies(response).length).toBe(2);
  });

  it("ends the session when the refresh token is rejected", async () => {
    vi.mocked(refreshSession).mockResolvedValue({ status: "rejected" });

    const response = await proxy(
      request("/en/tasks", { [REFRESH]: freshRefreshToken() }),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/en?next=");
    const cleared = sessionCookies(response);
    expect(cleared.length).toBe(3);
    for (const cookie of cleared) {
      expect(cookie).toMatch(/Max-Age=0/i);
    }
  });

  it("redirects to sign-in but leaves the cookies alone when the token was probably rotated by another replica", async () => {
    vi.mocked(refreshSession).mockResolvedValue({ status: "stale" });

    const response = await proxy(
      request("/en/tasks", { [REFRESH]: freshRefreshToken() }),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/en?next=");
    // Clearing here could overwrite the winner's fresh cookies in the browser.
    expect(sessionCookies(response)).toEqual([]);
  });

  it("does not sign anyone out because the API is down", async () => {
    vi.mocked(refreshSession).mockResolvedValue({ status: "unavailable" });

    const response = await proxy(
      request("/en/tasks", { [REFRESH]: freshRefreshToken() }),
    );

    expect(response.headers.get("location")).toBeNull();
    expect(sessionCookies(response)).toEqual([]);
  });
});

describe("capability negotiation", () => {
  it("sends a signed-in visitor away from a page the server switched off", async () => {
    vi.mocked(getServerCapabilities).mockResolvedValue({
      features: { search: { enabled: false } },
      updateStatus: "current",
      minimum: "",
      recommended: "",
      fetchedAt: 0,
    });

    const response = await proxy(
      request("/en/search", {
        [ACCESS]: fakeJwt({ sub: "u", expiresInSeconds: 600 }),
      }),
    );

    expect(new URL(response.headers.get("location") ?? "").pathname).toBe(
      "/en/forbidden",
    );
  });
});

describe("proxy: trailing-slash normalisation", () => {
  it("308-redirects a page URL with a trailing slash, keeping the query", async () => {
    const response = await proxy(request("/en/?next=%2Ftasks"));

    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/en?next=%2Ftasks",
    );
  });

  it("does not redirect the canonical form", async () => {
    const response = await proxy(request("/en"));

    expect(response.status).not.toBe(308);
  });
});
