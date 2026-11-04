import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/auth/callback/route";
import { OidcConfigError } from "@/shared/lib/auth/oidc/config";
import { PRE_AUTH_COOKIE } from "@/shared/lib/auth/oidc/pre-auth-cookie";

const completeLogin = vi.hoisted(() => vi.fn());
const reportError = vi.hoisted(() => vi.fn());

vi.mock("@/shared/lib/auth/oidc/login-flow", () => ({ completeLogin }));
vi.mock("@/shared/lib/errors/report-error", () => ({ reportError }));

beforeEach(() => {
  completeLogin.mockReset();
  reportError.mockReset();
});

function callbackRequest() {
  return new NextRequest(
    "http://localhost:3001/api/auth/callback?code=c&state=s",
    { headers: { cookie: `${PRE_AUTH_COOKIE}=sealed` } },
  );
}

function location(response: Response) {
  return new URL(response.headers.get("location") ?? "");
}

function preAuthCookieCleared(response: Response) {
  const cookie = response.headers
    .getSetCookie()
    .find((value) => value.startsWith(`${PRE_AUTH_COOKIE}=`));
  return cookie !== undefined && /max-age=0/i.test(cookie);
}

describe("GET /api/auth/callback (admin)", () => {
  it("stores the admin session cookies, redirects to next and clears the pre-auth cookie", async () => {
    completeLogin.mockResolvedValue({
      ok: true,
      next: "/en/admin/tasks",
      tokens: { accessToken: "access-token", refreshToken: "refresh-token" },
    });
    const response = await GET(callbackRequest());
    expect(location(response).pathname).toBe("/en/admin/tasks");
    const cookies = response.headers.getSetCookie();
    expect(
      cookies.some(
        (value) =>
          value.startsWith("aedst_admin_session=access-token") &&
          /httponly/i.test(value),
      ),
    ).toBe(true);
    expect(preAuthCookieCleared(response)).toBe(true);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(completeLogin).toHaveBeenCalledWith(
      expect.objectContaining({ sealed: "sealed" }),
    );
  });

  it("answers a failed validation with /forbidden and a coarse auth_error", async () => {
    completeLogin.mockResolvedValue({ ok: false, reason: "state" });
    const response = await GET(callbackRequest());
    expect(location(response).pathname).toBe("/forbidden");
    expect(location(response).searchParams.get("auth_error")).toBe("state");
    expect(preAuthCookieCleared(response)).toBe(true);
    expect(reportError).not.toHaveBeenCalled();
  });

  it("reports an unexpected failure and maps a config error to auth_error=config", async () => {
    const failure = new Error("token endpoint down");
    completeLogin.mockRejectedValueOnce(failure);
    let response = await GET(callbackRequest());
    expect(location(response).searchParams.get("auth_error")).toBe(
      "unavailable",
    );
    expect(reportError).toHaveBeenCalledWith(failure, {
      source: "bff",
      feature: "auth",
    });

    completeLogin.mockRejectedValueOnce(new OidcConfigError("bad"));
    response = await GET(callbackRequest());
    expect(location(response).searchParams.get("auth_error")).toBe("config");
    expect(preAuthCookieCleared(response)).toBe(true);
  });
});
