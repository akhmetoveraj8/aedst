import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/auth/login/route";
import { OidcConfigError } from "@/shared/lib/auth/oidc/config";
import { PRE_AUTH_COOKIE } from "@/shared/lib/auth/oidc/pre-auth-cookie";

const startLogin = vi.hoisted(() => vi.fn());
const reportError = vi.hoisted(() => vi.fn());

vi.mock("@/shared/lib/auth/oidc/login-flow", () => ({ startLogin }));
vi.mock("@/shared/lib/errors/report-error", () => ({ reportError }));

beforeEach(() => {
  startLogin.mockReset();
  reportError.mockReset();
});

function failureLocation(response: Response) {
  return new URL(response.headers.get("location") ?? "");
}

describe("GET /api/auth/login (admin)", () => {
  it("redirects to the IdP and seals the pre-auth cookie (httpOnly, lax, no-store)", async () => {
    startLogin.mockResolvedValue({
      location: "http://localhost:8085/authorize?x=1",
      sealed: "sealed-value",
    });
    const response = await GET(
      new Request("http://localhost:3001/api/auth/login?next=/en/admin/users"),
    );
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "http://localhost:8085/authorize?x=1",
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${PRE_AUTH_COOKIE}=sealed-value`);
    expect(cookie).toMatch(/httponly/i);
    expect(cookie).toMatch(/samesite=lax/i);
    expect(startLogin).toHaveBeenCalledWith(
      expect.objectContaining({ next: "/en/admin/users", register: false }),
    );
  });

  it("lands on /forbidden with auth_error=unavailable and reports an IdP failure", async () => {
    const failure = new Error("discovery failed");
    startLogin.mockRejectedValue(failure);
    const response = await GET(
      new Request("http://localhost:3001/api/auth/login"),
    );
    const location = failureLocation(response);
    expect(location.pathname).toBe("/forbidden");
    expect(location.searchParams.get("auth_error")).toBe("unavailable");
    expect(reportError).toHaveBeenCalledWith(failure, {
      source: "bff",
      feature: "auth",
    });
  });

  it("maps a misconfiguration to auth_error=config", async () => {
    startLogin.mockRejectedValue(new OidcConfigError("missing issuer"));
    const response = await GET(
      new Request("http://localhost:3001/api/auth/login"),
    );
    expect(failureLocation(response).searchParams.get("auth_error")).toBe(
      "config",
    );
  });
});
