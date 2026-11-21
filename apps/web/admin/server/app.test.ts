import { describe, expect, it } from "vitest";
import {
  ACCESS_COOKIE,
  cookieHeader,
  INDEX_HTML,
  makeHarness,
  REFRESH_COOKIE,
  setCookies,
} from "./test/harness";
import { tokenWithRoles } from "./test/jwt";

const PRODUCTION = {
  NODE_ENV: "production",
  ADMIN_ORIGIN: "http://localhost:3001",
  OIDC_ISSUER: "https://idp.example.com",
  OIDC_CLIENT_ID: "aedst-admin",
  OIDC_STATE_SECRET: "x".repeat(32),
};
const SENTRY = "https://abc@o1.ingest.sentry.io/42";

function nonceOf(response: Response): string {
  const csp = response.headers.get("content-security-policy") ?? "";
  return /'nonce-([^']+)'/.exec(csp)?.[1] ?? "";
}

describe("health", () => {
  it("answers 200 ok without touching any backend, uncached, with the API CSP", async () => {
    const { app, fetchMock, auth } = makeHarness();
    const response = await app.request("/api/healthz");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-security-policy")).toMatch(
      /^default-src 'none'/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(auth.refreshSession).not.toHaveBeenCalled();
  });

  it("supports HEAD for probes that do not read a body", async () => {
    const { app } = makeHarness();
    const response = await app.request("/api/healthz", { method: "HEAD" });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
  });
});

describe("HTML route: nonce and headers", () => {
  const admin = { [ACCESS_COOKIE]: tokenWithRoles(["admin"]) };

  it("replaces every placeholder with the nonce of the CSP header", async () => {
    const { app } = makeHarness();
    const response = await app.request("/en/admin", {
      headers: { cookie: cookieHeader(admin) },
    });
    expect(response.status).toBe(200);
    const body = await response.text();
    const nonce = nonceOf(response);
    expect(nonce).not.toBe("");
    expect(body).not.toContain("__CSP_NONCE__");
    const stamped = body.match(/nonce="([^"]+)"/g) ?? [];
    expect(stamped).toHaveLength(
      INDEX_HTML.match(/__CSP_NONCE__/g)?.length ?? -1,
    );
    expect(new Set(stamped)).toEqual(new Set([`nonce="${nonce}"`]));
  });

  it("mints a different nonce for every request", async () => {
    const { app } = makeHarness();
    const headers = { cookie: cookieHeader(admin) };
    const nonces = new Set<string>();
    for (let i = 0; i < 5; i++) {
      nonces.add(nonceOf(await app.request("/en/admin", { headers })));
    }
    expect(nonces.size).toBe(5);
  });

  it("sends the strict CSP, noindex and the static security headers, uncached", async () => {
    const { app } = makeHarness(PRODUCTION);
    const response = await app.request("/en/admin", {
      headers: { cookie: cookieHeader(admin) },
    });
    const csp = response.headers.get("content-security-policy") ?? "";
    expect(csp).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("strict-transport-security")).toContain(
      "max-age=63072000",
    );
    expect(response.headers.get("cross-origin-opener-policy")).toBe(
      "same-origin",
    );
    expect(response.headers.get("permissions-policy")).toContain("camera=()");
    expect(response.headers.get("x-request-id")).toBeTruthy();
  });

  it("serves robots.txt that disallows everything, to anonymous crawlers, with noindex", async () => {
    const { app } = makeHarness(PRODUCTION);
    const response = await app.request("/robots.txt");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(await response.text()).toBe("User-agent: *\nDisallow: /\n");
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
  });

  it("adds Trusted Types report-only and Reporting-Endpoints with a Sentry DSN", async () => {
    const { app } = makeHarness({ SENTRY_DSN: SENTRY });
    const response = await app.request("/en/admin", {
      headers: { cookie: cookieHeader(admin) },
    });
    expect(response.headers.get("content-security-policy-report-only")).toMatch(
      /^require-trusted-types-for 'script'; report-uri https:\/\/o1\.ingest\.sentry\.io\/api\/42\/security\//,
    );
    expect(response.headers.get("reporting-endpoints")).toContain(
      'csp-endpoint="https://o1.ingest.sentry.io/api/42/security/',
    );
    expect(response.headers.get("content-security-policy")).toContain(
      "report-to csp-endpoint",
    );
  });

  it("allows the Sentry ingest origin in connect-src (no tunnel)", async () => {
    const { app } = makeHarness({ SENTRY_DSN: SENTRY });
    const response = await app.request("/en/admin", {
      headers: { cookie: cookieHeader(admin) },
    });
    expect(response.headers.get("content-security-policy")).toContain(
      "connect-src 'self' https://o1.ingest.sentry.io",
    );
    const bare = await makeHarness().app.request("/en/admin", {
      headers: { cookie: cookieHeader(admin) },
    });
    expect(bare.headers.get("content-security-policy")).toContain(
      "connect-src 'self' ws:;",
    );
  });

  it("serves the SPA for any non-api, non-file path", async () => {
    const { app } = makeHarness();
    const response = await app.request("/some/deep/route", {
      headers: { cookie: cookieHeader(admin) },
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('<div id="root">');
  });

  it("omits the reporting headers without a DSN", async () => {
    const { app } = makeHarness();
    const response = await app.request("/en/admin", {
      headers: { cookie: cookieHeader(admin) },
    });
    expect(response.headers.get("reporting-endpoints")).toBeNull();
    expect(
      response.headers.get("content-security-policy-report-only"),
    ).toBeNull();
  });

  it("answers 503 when the build is missing", async () => {
    const { app } = makeHarness(
      {},
      { indexHtml: () => Promise.reject(new Error("ENOENT")) },
    );
    const response = await app.request("/en/forbidden");
    expect(response.status).toBe(503);
  });
});

describe("HTML route: guard", () => {
  it("sends an anonymous visitor to the admin's own login, 302, keeping path and query", async () => {
    const { app } = makeHarness();
    const response = await app.request("/en/admin?tab=2");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "/api/auth/login?next=%2Fen%2Fadmin%3Ftab%3D2",
    );
  });

  it("guards the root too (a / request must pass the guard)", async () => {
    const { app } = makeHarness();
    const response = await app.request("/");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/api/auth/login?next=%2F");
  });

  it("sends a signed-in non-operator to the forbidden page (locale kept when the path has one)", async () => {
    const { app } = makeHarness();
    const response = await app.request("/en/admin", {
      headers: {
        cookie: cookieHeader({ [ACCESS_COOKIE]: tokenWithRoles(["user"]) }),
      },
    });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/en/forbidden");

    // A path without a locale goes to the locale-less page; the SPA adds it.
    const root = await app.request("/", {
      headers: {
        cookie: cookieHeader({ [ACCESS_COOKIE]: tokenWithRoles(["user"]) }),
      },
    });
    expect(root.headers.get("location")).toBe("/forbidden");
  });

  it("serves the forbidden page to anonymous and non-operators (no loop)", async () => {
    const { app } = makeHarness();
    expect((await app.request("/en/forbidden")).status).toBe(200);
    expect((await app.request("/forbidden?auth_error=denied")).status).toBe(
      200,
    );
  });

  it.each(["admin", "support", "auditor"])("lets %s through", async (role) => {
    const { app } = makeHarness();
    const response = await app.request("/en/admin/audit", {
      headers: {
        cookie: cookieHeader({ [ACCESS_COOKIE]: tokenWithRoles([role]) }),
      },
    });
    expect(response.status).toBe(200);
  });

  it("serves only GET and HEAD documents", async () => {
    const { app } = makeHarness();
    expect((await app.request("/en/admin", { method: "POST" })).status).toBe(
      405,
    );
  });
});

describe("HTML route: refresh rotation", () => {
  const stale = {
    [ACCESS_COOKIE]: tokenWithRoles(["admin"], -120),
    [REFRESH_COOKIE]: "old-refresh",
  };

  it("rotates an expired access token, rewrites the cookies and serves the page", async () => {
    const { app, auth } = makeHarness();
    const accessToken = tokenWithRoles(["admin"], 600);
    auth.refreshSession.mockResolvedValue({
      status: "ok",
      tokens: {
        accessToken,
        refreshToken: "new-refresh",
        accessMaxAgeSeconds: 600,
        refreshMaxAgeSeconds: 3600,
      },
    });
    const response = await app.request("/en/admin", {
      headers: { cookie: cookieHeader(stale) },
    });
    expect(response.status).toBe(200);
    expect(auth.refreshSession).toHaveBeenCalledWith(
      "old-refresh",
      expect.anything(),
    );
    const { raw, values } = setCookies(response);
    expect(values[ACCESS_COOKIE]).toBe(accessToken);
    expect(values[REFRESH_COOKIE]).toBe("new-refresh");
    for (const line of raw) {
      expect(line).toMatch(/HttpOnly/i);
      expect(line).toMatch(/SameSite=Lax/i);
      expect(line).toMatch(/Path=\//);
    }
  });

  it("clears the session and signs in again when the refresh token is rejected", async () => {
    const { app, auth } = makeHarness();
    auth.refreshSession.mockResolvedValue({ status: "rejected" });
    const response = await app.request("/en/admin", {
      headers: { cookie: cookieHeader(stale) },
    });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("/api/auth/login");
    const { raw } = setCookies(response);
    expect(raw.filter((line) => /Max-Age=0/i.test(line))).toHaveLength(3);
  });

  it("leaves the cookies alone when the rotation was probably lost to another replica", async () => {
    const { app, auth } = makeHarness();
    auth.refreshSession.mockResolvedValue({ status: "stale" });
    const response = await app.request("/en/admin", {
      headers: { cookie: cookieHeader(stale) },
    });
    expect(response.status).toBe(302);
    expect(setCookies(response).raw).toEqual([]);
  });

  it("keeps the user in (stale roles) while the IdP is merely unavailable", async () => {
    const { app, auth } = makeHarness();
    auth.refreshSession.mockResolvedValue({ status: "unavailable" });
    const response = await app.request("/en/admin", {
      headers: { cookie: cookieHeader(stale) },
    });
    expect(response.status).toBe(200);
    expect(setCookies(response).raw).toEqual([]);
  });

  it("does not refresh for an unexpired token or for /api/healthz", async () => {
    const { app, auth } = makeHarness();
    await app.request("/en/admin", {
      headers: {
        cookie: cookieHeader({
          [ACCESS_COOKIE]: tokenWithRoles(["admin"]),
          [REFRESH_COOKIE]: "r",
        }),
      },
    });
    await app.request("/api/healthz", {
      headers: { cookie: cookieHeader(stale) },
    });
    expect(auth.refreshSession).not.toHaveBeenCalled();
  });
});

describe("static files", () => {
  it("serves hashed assets immutable and never serves index.html as a file", async () => {
    const { app } = makeHarness();
    const asset = await app.request("/assets/index-abc123.js");
    expect(asset.status).toBe(200);
    expect(asset.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(
      (await app.request("/favicon.svg")).headers.get("cache-control"),
    ).toBe("public, max-age=3600");
    expect((await app.request("/index.html")).status).toBe(404);
  });

  it("answers 404 for a missing asset instead of the SPA, and refuses traversal and dotfiles", async () => {
    const { app } = makeHarness();
    expect((await app.request("/assets/missing.js")).status).toBe(404);
    expect((await app.request("/assets/%2e%2e/index.html")).status).toBe(404);
    expect((await app.request("/..%2f..%2fetc/passwd.txt")).status).toBe(404);
    expect((await app.request("/.env")).status).toBe(404);
  });

  it("answers an unknown /api route with JSON 404 and no session work", async () => {
    const { app, auth } = makeHarness();
    const response = await app.request("/api/nope");
    expect(response.status).toBe(404);
    expect(auth.refreshSession).not.toHaveBeenCalled();
  });
});
