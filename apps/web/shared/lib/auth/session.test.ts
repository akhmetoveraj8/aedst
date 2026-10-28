import { beforeEach, describe, expect, it, vi } from "vitest";

import { getAccessToken, getSessionUserId } from "@/shared/lib/auth/session";
import { fakeJwt } from "@/test/jwt";

const jar = new Map<string, string>();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      jar.has(name) ? { name, value: jar.get(name) } : undefined,
  }),
}));

beforeEach(() => jar.clear());

describe("getAccessToken", () => {
  it("returns a valid token from the httpOnly cookie", async () => {
    const token = fakeJwt({ expiresInSeconds: 600 });
    jar.set("aedst_session", token);

    await expect(getAccessToken()).resolves.toBe(token);
  });

  it("returns undefined for an absent or expired token", async () => {
    await expect(getAccessToken()).resolves.toBeUndefined();

    jar.set("aedst_session", fakeJwt({ expiresInSeconds: -5 }));
    await expect(getAccessToken()).resolves.toBeUndefined();
  });
});

describe("getSessionUserId", () => {
  it("reads the subject of the current token", async () => {
    jar.set(
      "aedst_session",
      fakeJwt({ sub: "user-42", expiresInSeconds: 600 }),
    );

    await expect(getSessionUserId()).resolves.toBe("user-42");
  });

  it("is undefined when signed out", async () => {
    await expect(getSessionUserId()).resolves.toBeUndefined();
  });
});
