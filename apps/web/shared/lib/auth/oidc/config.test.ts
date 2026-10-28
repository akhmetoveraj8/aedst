import { describe, expect, it } from "vitest";

import { getOidcConfig, OidcConfigError } from "@/shared/lib/auth/oidc/config";

const env = {
  OIDC_ISSUER: "https://idp.example.com",
  OIDC_CLIENT_ID: "client",
  OIDC_CLIENT_SECRET: undefined,
  OIDC_PROJECT_ID: undefined,
  OIDC_SCOPE: undefined,
  OIDC_STATE_SECRET: "x".repeat(32),
};

describe("getOidcConfig", () => {
  it("derives redirect URIs from the public site URL and the default scopes", () => {
    const config = getOidcConfig(
      env,
      "https://app.example.com/some/path",
      true,
    );

    expect(config.redirectUri).toBe(
      "https://app.example.com/api/auth/callback",
    );
    expect(config.postLogoutRedirectUri).toBe("https://app.example.com");
    expect(config.scope).toBe("openid profile email offline_access");
    expect(config.clientSecret).toBeUndefined();
  });

  it("adds the ZITADEL project audience scope from OIDC_PROJECT_ID", () => {
    const config = getOidcConfig(
      { ...env, OIDC_PROJECT_ID: "123" },
      "https://a.example",
      true,
    );

    expect(config.scope).toContain("urn:zitadel:iam:org:project:id:123:aud");
  });

  it("lets OIDC_SCOPE replace the scopes entirely", () => {
    const config = getOidcConfig(
      { ...env, OIDC_PROJECT_ID: "123", OIDC_SCOPE: "openid roles" },
      "https://a.example",
      true,
    );

    expect(config.scope).toBe("openid roles");
  });

  it("fails with a clear error when the IdP is not configured", () => {
    expect(() =>
      getOidcConfig(
        { ...env, OIDC_ISSUER: undefined },
        "https://a.example",
        true,
      ),
    ).toThrow(OidcConfigError);
    expect(() =>
      getOidcConfig(
        { ...env, OIDC_CLIENT_ID: undefined },
        "https://a.example",
        true,
      ),
    ).toThrow(OidcConfigError);
  });

  it("accepts plain http only for loopback issuers", () => {
    const local = getOidcConfig(
      { ...env, OIDC_ISSUER: "http://localhost:8085" },
      "http://localhost:3000",
      false,
    );
    expect(local.allowInsecureHttp).toBe(true);

    expect(() =>
      getOidcConfig(
        { ...env, OIDC_ISSUER: "http://idp.example.com" },
        "https://a.example",
        false,
      ),
    ).toThrow(/https/);
  });

  it("requires the state secret in production but not in development", () => {
    const noSecret = { ...env, OIDC_STATE_SECRET: undefined };

    expect(() => getOidcConfig(noSecret, "https://a.example", true)).toThrow(
      /OIDC_STATE_SECRET/,
    );
    const first = getOidcConfig(noSecret, "http://localhost:3000", false);
    const second = getOidcConfig(noSecret, "http://localhost:3000", false);
    expect(first.stateSecret.length).toBeGreaterThanOrEqual(32);
    expect(second.stateSecret).toBe(first.stateSecret);
  });
});
