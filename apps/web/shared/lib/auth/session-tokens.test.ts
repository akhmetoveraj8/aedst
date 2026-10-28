import { describe, expect, it } from "vitest";

import { sessionTokensFromResponse } from "@/shared/lib/auth/session-tokens";

describe("sessionTokensFromResponse", () => {
  it("maps a complete token response to cookie lifetimes in seconds", () => {
    expect(
      sessionTokensFromResponse({
        access_token: "access",
        refresh_token: "refresh",
        expires_in: 900,
        id_token: "id",
      }),
    ).toEqual({
      accessToken: "access",
      refreshToken: "refresh",
      accessMaxAgeSeconds: 900,
      refreshMaxAgeSeconds: 30 * 24 * 60 * 60,
      idToken: "id",
    });
  });

  it("falls back to the previous refresh token when none is rotated in", () => {
    expect(
      sessionTokensFromResponse({ access_token: "a", expires_in: 60 }, "old")
        ?.refreshToken,
    ).toBe("old");
  });

  it("refuses a response without an access or refresh token", () => {
    expect(sessionTokensFromResponse({ access_token: "a" })).toBeNull();
    expect(
      sessionTokensFromResponse({ access_token: "", refresh_token: "r" }),
    ).toBeNull();
  });

  it("uses a default lifetime when expires_in is missing or not positive", () => {
    const base = { access_token: "a", refresh_token: "r" };
    expect(sessionTokensFromResponse(base)?.accessMaxAgeSeconds).toBe(900);
    expect(
      sessionTokensFromResponse({ ...base, expires_in: 0 })
        ?.accessMaxAgeSeconds,
    ).toBe(900);
  });
});
