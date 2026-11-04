import { describe, expect, it } from "vitest";

import { parseEnv } from "./env";

const PROD = {
  NODE_ENV: "production",
  ADMIN_ORIGIN: "https://admin.example.com",
  OIDC_ISSUER: "https://idp.example.com",
  OIDC_CLIENT_ID: "aedst-admin",
  OIDC_STATE_SECRET: "x".repeat(32),
};

describe("parseEnv", () => {
  it("has working development defaults", () => {
    const env = parseEnv({});
    expect(env.ADMIN_ORIGIN).toBe("http://localhost:3001");
    expect(env.listenPort).toBe(3101);
    expect(env.secureSite).toBe(false);
    expect(env.TRUST_PROXY).toBe(false);
  });

  it("prefers ADMIN_BFF_PORT over PORT and treats empty strings as unset", () => {
    expect(parseEnv({ PORT: "3001", ADMIN_BFF_PORT: "" }).listenPort).toBe(
      3001,
    );
    expect(parseEnv({ PORT: "3001", ADMIN_BFF_PORT: "4000" }).listenPort).toBe(
      4000,
    );
  });

  it("normalizes the origin and detects a secure site", () => {
    const env = parseEnv({ ADMIN_ORIGIN: "https://admin.example.com/ignored" });
    expect(env.ADMIN_ORIGIN).toBe("https://admin.example.com");
    expect(env.secureSite).toBe(true);
  });

  it("requires the IdP settings and a 32+ char state secret in production", () => {
    expect(() => parseEnv({ NODE_ENV: "production" })).toThrow(/ADMIN_ORIGIN/);
    expect(() => parseEnv({ ...PROD, OIDC_STATE_SECRET: "short" })).toThrow();
    expect(parseEnv(PROD).isProduction).toBe(true);
  });

  it("refuses a plain-http origin in production unless it is loopback", () => {
    // Plain http drops Secure and the __Host- prefix from every cookie.
    expect(() =>
      parseEnv({ ...PROD, ADMIN_ORIGIN: "http://admin.example.com" }),
    ).toThrow(/https/);
    expect(
      parseEnv({ ...PROD, ADMIN_ORIGIN: "http://127.0.0.1:3001" }).secureSite,
    ).toBe(false);
    expect(
      parseEnv({ ...PROD, ADMIN_ORIGIN: "http://localhost:3001" }),
    ).toBeTruthy();
  });

  it("does not share the product app's default cookie name", () => {
    expect(parseEnv({}).AUTH_COOKIE_NAME).toBe("aedst_admin_session");
    expect(parseEnv({ AUTH_COOKIE_NAME: "custom" }).AUTH_COOKIE_NAME).toBe(
      "custom",
    );
  });

  it("rejects malformed values", () => {
    expect(() => parseEnv({ API_BASE_URL: "not a url" })).toThrow();
    expect(() => parseEnv({ PORT: "70000" })).toThrow();
    expect(() => parseEnv({ TRUST_PROXY: "maybe" })).toThrow();
  });
});
