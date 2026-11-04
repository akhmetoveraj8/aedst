import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildEndSessionUrl,
  revokeRefreshToken,
} from "@/shared/lib/auth/oidc/login-flow";
import { logoutAction } from "./auth-actions";

type SetCall = [string, string, Record<string, unknown>];
const setCalls: SetCall[] = [];
const jar = new Map<string, string>();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      jar.has(name) ? { name, value: jar.get(name) } : undefined,
    set: (name: string, value: string, options: Record<string, unknown>) => {
      setCalls.push([name, value, options]);
    },
  }),
}));

// The OIDC calls themselves are covered by login-flow.test.ts.
vi.mock("@/shared/lib/auth/oidc/login-flow", () => ({
  buildEndSessionUrl: vi.fn(),
  revokeRefreshToken: vi.fn(),
}));

beforeEach(() => {
  setCalls.length = 0;
  jar.clear();
  vi.mocked(buildEndSessionUrl).mockResolvedValue(null);
});

describe("logoutAction", () => {
  it("clears every session cookie, revokes the refresh token and returns the IdP end_session URL", async () => {
    jar.set("aedst_session_refresh", "refresh-1");
    jar.set("aedst_session_id", "id-token-1");
    vi.mocked(buildEndSessionUrl).mockResolvedValue(
      "http://localhost:8085/oidc/v1/end_session?id_token_hint=id-token-1",
    );

    const result = await logoutAction();

    expect(result.endSessionUrl).toContain("end_session");
    expect(revokeRefreshToken).toHaveBeenCalledWith(
      expect.objectContaining({ refreshToken: "refresh-1" }),
    );
    expect(buildEndSessionUrl).toHaveBeenCalledWith(
      expect.objectContaining({ idToken: "id-token-1" }),
    );
    expect(setCalls.map(([name, value]) => [name, value])).toEqual([
      ["aedst_session", ""],
      ["aedst_session_refresh", ""],
      ["aedst_session_id", ""],
    ]);
    for (const [, , options] of setCalls) {
      expect(options.maxAge).toBe(0);
    }
  });

  it("returns no URL when the IdP has no end_session endpoint", async () => {
    jar.set("aedst_session_refresh", "refresh-1");

    await expect(logoutAction()).resolves.toEqual({ endSessionUrl: null });
  });

  it("still signs this browser out when the IdP calls blow up", async () => {
    jar.set("aedst_session_refresh", "refresh-1");
    vi.mocked(revokeRefreshToken).mockRejectedValue(new Error("boom"));

    await expect(logoutAction()).resolves.toEqual({ endSessionUrl: null });
    expect(setCalls).toHaveLength(3);
  });

  it("does not try to revoke when there is no session", async () => {
    await logoutAction();

    expect(revokeRefreshToken).not.toHaveBeenCalled();
    expect(setCalls).toHaveLength(3);
  });
});
