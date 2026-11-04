import { beforeEach, describe, expect, it } from "vitest";

import { clearDiscoveryCache } from "@/shared/lib/auth/oidc/client";
import { completeLogin, startLogin } from "@/shared/lib/auth/oidc/login-flow";
import {
  createFakeIdp,
  idToken,
  TEST_CLIENT_ID,
  TEST_ISSUER,
} from "@/test/mocks/oidc";
import {
  begin,
  callback,
  config,
  idpFor,
  REDIRECT,
  run,
} from "./login-flow.test-support";

beforeEach(() => clearDiscoveryCache());

describe("startLogin", () => {
  it("builds a PKCE S256 authorization request with state, nonce and scopes", async () => {
    const idp = createFakeIdp();

    const { url, params } = await begin(idp);

    expect(url.origin + url.pathname).toBe(`${TEST_ISSUER}/oauth/v2/authorize`);
    expect(params.get("client_id")).toBe(TEST_CLIENT_ID);
    expect(params.get("redirect_uri")).toBe(REDIRECT);
    expect(params.get("response_type")).toBe("code");
    expect(params.get("code_challenge_method")).toBe("S256");
    expect(params.get("code_challenge")).toMatch(/^[\w-]{43}$/);
    expect(params.get("state")).toBeTruthy();
    expect(params.get("nonce")).toBeTruthy();
    expect(params.get("scope")?.split(" ")).toEqual([
      "openid",
      "profile",
      "email",
      "offline_access",
      "urn:zitadel:iam:org:project:id:proj-1:aud",
    ]);
    expect(params.has("prompt")).toBe(false);
  });

  it("asks ZITADEL for the registration form with prompt=create", async () => {
    const { params } = await begin(createFakeIdp(), { register: true });

    expect(params.get("prompt")).toBe("create");
  });

  it("refuses an IdP that cannot do PKCE S256", async () => {
    const idp = createFakeIdp({
      discovery: { code_challenge_methods_supported: ["plain"] },
    });

    await expect(
      startLogin({ config, deps: { fetch: idp.fetch } }),
    ).rejects.toThrow(/S256/);
  });

  it("uses fresh state, nonce and verifier on every login", async () => {
    const idp = createFakeIdp();
    const first = await begin(idp);
    const second = await begin(idp);

    expect(first.params.get("state")).not.toBe(second.params.get("state"));
    expect(first.params.get("nonce")).not.toBe(second.params.get("nonce"));
    expect(first.started.sealed).not.toBe(second.started.sealed);
  });

  it("caches discovery between logins", async () => {
    const idp = createFakeIdp();
    await begin(idp);
    await begin(idp);

    expect(idp.discoveryCalls).toBe(1);
  });
});

describe("completeLogin", () => {
  it("exchanges the code with the PKCE verifier and returns the session tokens and destination", async () => {
    const idp = createFakeIdp();
    const begun = await begin(idp, { next: "/tasks?status=done" });
    const real = idpFor(begun);

    const result = await run(begun, real, {
      code: "the-code",
      state: begun.params.get("state") ?? "",
    });

    expect(result).toMatchObject({
      ok: true,
      next: "/tasks?status=done",
      tokens: {
        refreshToken: "rt-1",
        accessMaxAgeSeconds: 900,
      },
    });
    expect(result.ok && result.tokens.idToken).toBeTruthy();
  });

  it("never carries an off-site destination through the round trip", async () => {
    const begun = await begin(createFakeIdp(), {
      next: "https://evil.example/phish",
    });
    const result = await run(begun, idpFor(begun), {
      code: "the-code",
      state: begun.params.get("state") ?? "",
    });

    expect(result).toMatchObject({ ok: true, next: "/tasks" });
  });

  it("rejects a state that does not match the pre-auth cookie", async () => {
    const begun = await begin(createFakeIdp());
    const idp = idpFor(begun);

    const result = await run(begun, idp, { code: "the-code", state: "forged" });

    expect(result).toMatchObject({ ok: false, reason: "invalid" });
    expect(idp.tokenCalls).toHaveLength(0);
  });

  it("rejects a callback without state", async () => {
    const begun = await begin(createFakeIdp());
    const idp = idpFor(begun);

    const result = await run(begun, idp, { code: "the-code" });

    expect(result).toMatchObject({ ok: false, reason: "invalid" });
    expect(idp.tokenCalls).toHaveLength(0);
  });

  it("rejects a callback without a code before calling the token endpoint", async () => {
    const begun = await begin(createFakeIdp());
    const idp = idpFor(begun);

    const result = await run(begun, idp, {
      state: begun.params.get("state") ?? "",
    });

    expect(result).toMatchObject({ ok: false, reason: "invalid" });
    expect(idp.tokenCalls).toHaveLength(0);
  });

  it("rejects an ID token whose nonce is not the one we sent", async () => {
    const begun = await begin(createFakeIdp());

    const result = await run(begun, idpFor(begun, {}, "other-nonce"), {
      code: "the-code",
      state: begun.params.get("state") ?? "",
    });

    expect(result).toMatchObject({ ok: false, reason: "invalid" });
  });

  it("rejects an ID token without a nonce", async () => {
    const begun = await begin(createFakeIdp());

    const result = await run(begun, idpFor(begun, {}, null), {
      code: "the-code",
      state: begun.params.get("state") ?? "",
    });

    expect(result).toMatchObject({ ok: false, reason: "invalid" });
  });

  it("rejects a response without an ID token", async () => {
    const begun = await begin(createFakeIdp());

    const result = await run(begun, idpFor(begun, { id_token: undefined }), {
      code: "the-code",
      state: begun.params.get("state") ?? "",
    });

    expect(result).toMatchObject({ ok: false, reason: "invalid" });
  });

  it("rejects an ID token issued for another client", async () => {
    const begun = await begin(createFakeIdp());
    const nonce = begun.params.get("nonce") ?? "";

    const result = await run(
      begun,
      idpFor(begun, { id_token: idToken({ nonce, aud: ["someone-else"] }) }),
      { code: "the-code", state: begun.params.get("state") ?? "" },
    );

    expect(result).toMatchObject({ ok: false, reason: "invalid" });
  });

  it("reports an opaque access token with an actionable reason", async () => {
    const begun = await begin(createFakeIdp());

    const result = await run(begun, idpFor(begun, { access_token: "opaque" }), {
      code: "the-code",
      state: begun.params.get("state") ?? "",
    });

    expect(result).toMatchObject({ ok: false, reason: "opaque_token" });
  });

  it("maps an IdP refusal to denied and keeps the destination", async () => {
    const begun = await begin(createFakeIdp(), { next: "/search" });

    const result = await run(begun, createFakeIdp(), {
      error: "access_denied",
      state: begun.params.get("state") ?? "",
    });

    expect(result).toEqual({ ok: false, reason: "denied", next: "/search" });
  });

  it("maps a rejected code (replay, wrong verifier) to invalid", async () => {
    const begun = await begin(createFakeIdp());

    const result = await run(begun, idpFor(begun), {
      code: "stolen-code",
      state: begun.params.get("state") ?? "",
    });

    expect(result).toMatchObject({ ok: false, reason: "invalid" });
  });

  it("reports an unreachable IdP as unavailable", async () => {
    const begun = await begin(createFakeIdp());
    const offline = createFakeIdp();
    offline.fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    clearDiscoveryCache();

    const result = await run(begun, offline, {
      code: "the-code",
      state: begun.params.get("state") ?? "",
    });

    expect(result).toMatchObject({ ok: false, reason: "unavailable" });
  });

  it("treats a missing, expired or foreign pre-auth cookie as expired", async () => {
    const begun = await begin(createFakeIdp());
    const idp = idpFor(begun);
    const query = { code: "the-code", state: begun.params.get("state") ?? "" };

    expect(await run(begun, idp, query, null)).toEqual({
      ok: false,
      reason: "expired",
    });
    expect(await run(begun, idp, query, "garbage")).toMatchObject({
      reason: "expired",
    });
    const stale = await completeLogin({
      config,
      callbackUrl: callback(query),
      sealed: begun.started.sealed,
      deps: { fetch: idp.fetch },
      nowMs: Date.now() + 11 * 60 * 1000,
    });
    expect(stale).toMatchObject({ ok: false, reason: "expired" });
    expect(idp.tokenCalls).toHaveLength(0);
  });
});
