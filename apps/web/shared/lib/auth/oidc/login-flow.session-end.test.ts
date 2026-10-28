import { beforeEach, describe, expect, it } from "vitest";

import { clearDiscoveryCache } from "@/shared/lib/auth/oidc/client";
import {
  buildEndSessionUrl,
  revokeRefreshToken,
} from "@/shared/lib/auth/oidc/login-flow";
import { createFakeIdp, TEST_CLIENT_ID, TEST_ISSUER } from "@/test/mocks/oidc";
import { config } from "./login-flow.test-support";

beforeEach(() => clearDiscoveryCache());

describe("buildEndSessionUrl", () => {
  it("builds the RP-initiated logout URL with id_token_hint and post_logout_redirect_uri", async () => {
    const url = new URL(
      (await buildEndSessionUrl({
        config,
        idToken: "the-id-token",
        deps: { fetch: createFakeIdp().fetch },
      })) ?? "",
    );

    expect(url.origin + url.pathname).toBe(
      `${TEST_ISSUER}/oidc/v1/end_session`,
    );
    expect(url.searchParams.get("id_token_hint")).toBe("the-id-token");
    expect(url.searchParams.get("post_logout_redirect_uri")).toBe(
      "http://localhost:3000",
    );
    expect(url.searchParams.get("client_id")).toBe(TEST_CLIENT_ID);
  });

  it("is null when the IdP advertises no end_session_endpoint", async () => {
    const idp = createFakeIdp({
      discovery: { end_session_endpoint: undefined },
    });

    await expect(
      buildEndSessionUrl({ config, idToken: "x", deps: { fetch: idp.fetch } }),
    ).resolves.toBeNull();
  });

  it("is null, not an error, when the IdP is unreachable", async () => {
    const offline = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;

    await expect(
      buildEndSessionUrl({ config, idToken: "x", deps: { fetch: offline } }),
    ).resolves.toBeNull();
  });
});

describe("revokeRefreshToken", () => {
  it("revokes the refresh token at the IdP", async () => {
    const idp = createFakeIdp();

    await revokeRefreshToken({
      config,
      refreshToken: "rt-9",
      deps: { fetch: idp.fetch },
    });

    expect(idp.revoked).toEqual(["rt-9"]);
  });

  it("never throws", async () => {
    const offline = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;

    await expect(
      revokeRefreshToken({
        config,
        refreshToken: "x",
        deps: { fetch: offline },
      }),
    ).resolves.toBeUndefined();
  });
});
