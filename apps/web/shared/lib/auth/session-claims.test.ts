import { describe, expect, it } from "vitest";

import {
  decodeSessionClaims,
  decodeSessionIdentity,
  decodeSessionRoles,
  isAccessTokenExpired,
} from "@/shared/lib/auth/session-claims";

function jwt(payload: object): string {
  const encode = (value: object) =>
    btoa(
      String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value))),
    )
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  return `${encode({ alg: "none" })}.${encode(payload)}.signature`;
}

describe("decodeSessionClaims", () => {
  it("reads sub and exp from a base64url payload", () => {
    expect(decodeSessionClaims(jwt({ sub: "user-1", exp: 123 }))).toEqual({
      sub: "user-1",
      exp: 123,
    });
  });

  it("handles payloads that need base64 padding and non-ASCII text", () => {
    expect(decodeSessionClaims(jwt({ sub: "юзер", exp: 1 }))?.sub).toBe("юзер");
  });

  it("ignores claims of the wrong type", () => {
    expect(decodeSessionClaims(jwt({ sub: 5, exp: "soon" }))).toEqual({
      sub: undefined,
      exp: undefined,
    });
  });

  it.each(["", "not-a-jwt", "a.b.c", "a..c"])(
    "returns null for garbage %j",
    (token) => {
      expect(decodeSessionClaims(token)).toBeNull();
    },
  );

  it("returns null when the payload is JSON but not an object", () => {
    expect(decodeSessionClaims(jwt(["x"] as unknown as object))).not.toBeNull();
    expect(decodeSessionClaims(`a.${btoa("null")}.c`)).toBeNull();
  });
});

describe("isAccessTokenExpired", () => {
  const now = 1_700_000_000_000;

  it("is false for a token valid well beyond the skew window", () => {
    expect(isAccessTokenExpired(jwt({ exp: now / 1000 + 600 }), now)).toBe(
      false,
    );
  });

  it("treats a token expiring within 30s as expired, to refresh early", () => {
    expect(isAccessTokenExpired(jwt({ exp: now / 1000 + 10 }), now)).toBe(true);
  });

  it("is true for a past exp", () => {
    expect(isAccessTokenExpired(jwt({ exp: now / 1000 - 1 }), now)).toBe(true);
  });

  it("is true for unreadable tokens and tokens without exp", () => {
    expect(isAccessTokenExpired("garbage", now)).toBe(true);
    expect(isAccessTokenExpired(jwt({ sub: "x" }), now)).toBe(true);
  });
});

describe("decodeSessionRoles", () => {
  it("reads a first-party roles array", () => {
    expect(decodeSessionRoles(jwt({ roles: ["user", "admin", 3] }))).toEqual([
      "user",
      "admin",
    ]);
  });

  it("follows a dotted path such as Keycloak's realm_access.roles", () => {
    const token = jwt({ realm_access: { roles: ["admin"] } });
    expect(decodeSessionRoles(token, "realm_access.roles")).toEqual(["admin"]);
    expect(decodeSessionRoles(token, "realm_access.missing")).toEqual([]);
  });

  it("prefers an exact claim name containing dots over path splitting", () => {
    const token = jwt({ "https://example.com/roles": ["a"] });
    expect(decodeSessionRoles(token, "https://example.com/roles")).toEqual([
      "a",
    ]);
  });

  it("understands Zitadel role objects and space-separated strings", () => {
    expect(
      decodeSessionRoles(jwt({ roles: { editor: {}, admin: {} } })),
    ).toEqual(["admin", "editor"]);
    expect(decodeSessionRoles(jwt({ roles: "user  admin" }))).toEqual([
      "user",
      "admin",
    ]);
  });

  it("reads ZITADEL's urn:zitadel:iam:org:project:roles object, keyed by role", () => {
    const token = jwt({
      "urn:zitadel:iam:org:project:roles": {
        user: { "org-1": "acme.localhost" },
        admin: { "org-1": "acme.localhost", "org-2": "other.localhost" },
      },
    });
    expect(
      decodeSessionRoles(token, "urn:zitadel:iam:org:project:roles"),
    ).toEqual(["admin", "user"]);
  });

  it("keeps only roles granted in the configured organisation, failing closed", () => {
    const token = jwt({
      "urn:zitadel:iam:org:project:roles": {
        user: { "org-1": "acme.localhost" },
        admin: { "org-2": "other.localhost" },
        broken: "no-org-info",
        empty: {},
      },
    });
    const claim = "urn:zitadel:iam:org:project:roles";
    expect(decodeSessionRoles(token, claim, "org-1")).toEqual(["user"]);
    expect(decodeSessionRoles(token, claim, "org-2")).toEqual(["admin"]);
    expect(decodeSessionRoles(token, claim, "org-3")).toEqual([]);
  });

  it("applies the organisation filter only to object claims", () => {
    expect(
      decodeSessionRoles(jwt({ roles: ["admin"] }), "roles", "org-1"),
    ).toEqual(["admin"]);
    expect(decodeSessionRoles(jwt({ roles: "a b" }), "roles", "org-1")).toEqual(
      ["a", "b"],
    );
  });

  it("returns no roles for garbage or a missing claim", () => {
    expect(decodeSessionRoles("garbage")).toEqual([]);
    expect(decodeSessionRoles(jwt({ sub: "u" }))).toEqual([]);
    expect(decodeSessionRoles(jwt({ roles: 5 }))).toEqual([]);
  });
});

describe("decodeSessionIdentity", () => {
  it("reads email, name and preferred_username from the ID token", () => {
    expect(
      decodeSessionIdentity(
        jwt({
          email: "ada@example.com",
          name: "Ada",
          preferred_username: "ada",
        }),
      ),
    ).toEqual({ email: "ada@example.com", name: "Ada", username: "ada" });
  });

  it("ignores missing, empty and mistyped claims and garbage", () => {
    expect(decodeSessionIdentity(jwt({ email: "", name: 3 }))).toEqual({
      email: undefined,
      name: undefined,
      username: undefined,
    });
    expect(decodeSessionIdentity("garbage")).toEqual({});
  });
});
