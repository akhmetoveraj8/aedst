import { beforeEach, describe, expect, it } from "vitest";

import { clearDiscoveryCache } from "@/shared/lib/auth/oidc/client";
import { completeLogin } from "@/shared/lib/auth/oidc/login-flow";
import {
  createFakeIdp,
  foreignSigningKey,
  idToken,
  TEST_CLIENT_ID,
  TEST_ISSUER,
} from "@/test/mocks/oidc";
import {
  begin,
  callback,
  config,
  idpFor,
  run,
} from "./login-flow.test-support";

beforeEach(() => clearDiscoveryCache());

describe("completeLogin: ID token signature", () => {
  async function loginWith(idTokenFor: (nonce: string) => string) {
    const begun = await begin(createFakeIdp());
    const idp = idpFor(begun, {
      id_token: idTokenFor(begun.params.get("nonce") ?? ""),
    });
    const result = await run(begun, idp, {
      code: "the-code",
      state: begun.params.get("state") ?? "",
    });
    return { result, idp };
  }

  it("accepts a correctly signed ID token and fetches the JWKS from jwks_uri once", async () => {
    const { result, idp } = await loginWith((nonce) => idToken({ nonce }));

    expect(result).toMatchObject({ ok: true });
    expect(idp.jwksCalls).toBe(1);
  });

  it("rejects an ID token whose payload was tampered with after signing", async () => {
    const { result } = await loginWith((nonce) => {
      const [header, , signature] = idToken({ nonce }).split(".");
      const forged = Buffer.from(
        JSON.stringify({
          iss: TEST_ISSUER,
          aud: [TEST_CLIENT_ID],
          sub: "admin",
          nonce,
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + 600,
        }),
      ).toString("base64url");
      return `${header}.${forged}.${signature}`;
    });

    expect(result).toMatchObject({ ok: false, reason: "invalid" });
  });

  it("rejects an ID token signed by a key the issuer does not publish", async () => {
    const { result } = await loginWith((nonce) =>
      idToken({ nonce }, { key: foreignSigningKey }),
    );

    expect(result).toMatchObject({ ok: false, reason: "invalid" });
  });

  it("rejects an ID token whose kid is not in the JWKS", async () => {
    const { result } = await loginWith((nonce) =>
      idToken({ nonce }, { kid: "unknown-key" }),
    );

    expect(result).toMatchObject({ ok: false, reason: "invalid" });
  });

  it("rejects alg none", async () => {
    const { result } = await loginWith((nonce) =>
      idToken({ nonce }, { alg: "none" }),
    );

    expect(result).toMatchObject({ ok: false, reason: "invalid" });
  });

  it.each(["HS256", "PS256", "RS512"])(
    "rejects an ID token claiming %s, which is not on the allow-list",
    async (alg) => {
      const { result } = await loginWith((nonce) =>
        idToken({ nonce }, { alg }),
      );

      expect(result).toMatchObject({ ok: false, reason: "invalid" });
    },
  );

  it("rejects a validly signed ID token from another issuer", async () => {
    const { result } = await loginWith((nonce) =>
      idToken({ nonce, iss: "https://evil.example" }),
    );

    expect(result).toMatchObject({ ok: false, reason: "invalid" });
  });

  it("reports an unreachable JWKS endpoint as unavailable, not as a bad token", async () => {
    const begun = await begin(createFakeIdp());
    const idp = idpFor(begun);
    const base = idp.fetch;
    const noJwks = (async (
      input: string | URL | Request,
      init?: RequestInit,
    ) =>
      String(input).endsWith("/oauth/v2/keys")
        ? Promise.reject(new TypeError("fetch failed"))
        : base(input, init)) as typeof fetch;

    const result = await completeLogin({
      config,
      callbackUrl: callback({
        code: "the-code",
        state: begun.params.get("state") ?? "",
      }),
      sealed: begun.started.sealed,
      deps: { fetch: noJwks },
    });

    expect(result).toMatchObject({ ok: false, reason: "unavailable" });
  });
});
