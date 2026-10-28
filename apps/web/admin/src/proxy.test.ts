// @vitest-environment node
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import { refreshSession } from "@/shared/lib/auth/refresh-session";
import { fakeJwt } from "@/test/jwt";
import proxy from "./proxy";

vi.mock("@/shared/lib/auth/refresh-session", () => ({
  refreshSession: vi.fn(),
}));

const ACCESS = "aedst_admin_session";

function request(path: string, cookies: Record<string, string> = {}) {
  const cookie = Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
  return new NextRequest(`http://localhost:3001${path}`, {
    headers: cookie ? { cookie } : {},
  });
}

/** An unsigned token whose `roles` claim is a plain array (AUTH_ROLES_CLAIM default). */
function tokenWithRoles(roles: string[]): string {
  const encode = (value: object) =>
    btoa(JSON.stringify(value))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  const exp = Math.floor(Date.now() / 1000) + 600;
  return `${encode({ alg: "none" })}.${encode({ sub: "u", exp, roles })}.sig`;
}

describe("admin proxy", () => {
  it("emits one nonce CSP and noindex on pages", async () => {
    const response = await proxy(request("/en/forbidden"));
    const csp = response.headers.get("content-security-policy") ?? "";
    expect(csp).toMatch(/script-src[^;]*'nonce-/);
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
  });

  it("gives /api only the static CSP and never touches the session", async () => {
    const response = await proxy(
      request("/api/rpc/x", { [ACCESS]: fakeJwt({ expiresInSeconds: 60 }) }),
    );
    expect(response.headers.get("content-security-policy")).toMatch(
      /^default-src 'none'/,
    );
    expect(refreshSession).not.toHaveBeenCalled();
  });

  it("sends an anonymous visitor to the admin's own login", async () => {
    const response = await proxy(request("/en/admin"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3001/api/auth/login?next=%2Fen%2Fadmin",
    );
  });

  it("sends a signed-in non-admin to /forbidden", async () => {
    const response = await proxy(
      request("/en/admin", { [ACCESS]: tokenWithRoles(["user"]) }),
    );
    expect(response.headers.get("location")).toBe(
      "http://localhost:3001/en/forbidden",
    );
  });

  it("lets an admin through", async () => {
    const response = await proxy(
      request("/en/admin", { [ACCESS]: tokenWithRoles(["admin"]) }),
    );
    expect(response.headers.get("location")).toBeNull();
  });
});
