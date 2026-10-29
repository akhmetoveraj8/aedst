import { describe, expect, it } from "vitest";

import {
  classifySession,
  decideRoute,
  splitLocale,
} from "@/app/config/security/route-guard";
import { fakeJwt } from "@/test/jwt";

describe("classifySession", () => {
  it("is active with an unexpired access token", () => {
    const accessToken = fakeJwt({ expiresInSeconds: 600 });
    expect(classifySession({ accessToken, refreshToken: undefined })).toBe(
      "active",
    );
  });

  it("is refreshable with only a refresh token or an expired access token", () => {
    expect(classifySession({ accessToken: undefined, refreshToken: "r" })).toBe(
      "refreshable",
    );
    const accessToken = fakeJwt({ expiresInSeconds: -60 });
    expect(classifySession({ accessToken, refreshToken: "r" })).toBe(
      "refreshable",
    );
  });

  it("is anonymous with neither", () => {
    expect(
      classifySession({ accessToken: undefined, refreshToken: undefined }),
    ).toBe("anonymous");
  });
});

describe("splitLocale", () => {
  it("splits a locale-prefixed path and ignores others", () => {
    expect(splitLocale("/en/admin/users")).toEqual({
      locale: "en",
      rest: "/admin/users",
    });
    expect(splitLocale("/tj")).toEqual({ locale: "tj", rest: "" });
    expect(splitLocale("/xx/admin")).toBeNull();
  });
});

describe("decideRoute", () => {
  it("sends an anonymous visitor to the admin's own login, keeping the path", () => {
    expect(
      decideRoute({ pathname: "/ru/admin/users", session: "anonymous" }),
    ).toEqual({
      type: "redirect",
      location: "/api/auth/login?next=%2Fru%2Fadmin%2Fusers",
    });
  });

  it("sends a signed-in user without the admin role to forbidden", () => {
    expect(
      decideRoute({
        pathname: "/en/admin",
        session: "active",
        roles: ["user"],
      }),
    ).toEqual({ type: "redirect", location: "/en/forbidden" });
    expect(
      decideRoute({ pathname: "/en/admin", session: "refreshable", roles: [] }),
    ).toEqual({ type: "redirect", location: "/en/forbidden" });
  });

  it("lets an admin through", () => {
    expect(
      decideRoute({
        pathname: "/en/admin/audit",
        session: "active",
        roles: ["admin"],
      }),
    ).toEqual({ type: "next" });
  });

  it("lets support and auditor operators through", () => {
    for (const role of ["support", "auditor"]) {
      expect(
        decideRoute({
          pathname: "/en/admin",
          session: "active",
          roles: [role],
        }),
      ).toEqual({ type: "next" });
    }
  });

  it("always serves the forbidden page itself (no redirect loop)", () => {
    expect(
      decideRoute({ pathname: "/en/forbidden", session: "active", roles: [] }),
    ).toEqual({ type: "next" });
  });
});
