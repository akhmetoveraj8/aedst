import { afterEach, describe, expect, it, vi } from "vitest";

import { refreshSession } from "@/shared/lib/auth/refresh-session";
import {
  createFakeIdp,
  foreignSigningKey,
  idToken,
  TEST_CLIENT_ID,
} from "@/test/mocks/oidc";

const tokenBody = {
  access_token: "new-access",
  refresh_token: "new-refresh",
  token_type: "Bearer",
  expires_in: 900,
};

afterEach(() => vi.useRealTimers());

describe("refreshSession", () => {
  it("runs the refresh_token grant against the discovered token endpoint", async () => {
    const idp = createFakeIdp({ onToken: () => ({ body: tokenBody }) });

    await expect(
      refreshSession("rt-ok", { fetch: idp.fetch }),
    ).resolves.toEqual({
      status: "ok",
      tokens: {
        accessToken: "new-access",
        refreshToken: "new-refresh",
        accessMaxAgeSeconds: 900,
        refreshMaxAgeSeconds: 30 * 24 * 60 * 60,
        idToken: undefined,
      },
    });
    const sent = idp.tokenCalls[0];
    expect(sent?.get("grant_type")).toBe("refresh_token");
    expect(sent?.get("refresh_token")).toBe("rt-ok");
    expect(sent?.get("client_id")).toBe(TEST_CLIENT_ID);
  });

  it("keeps the old refresh token when the IdP does not rotate it", async () => {
    const idp = createFakeIdp({
      onToken: () => ({
        body: { access_token: "a2", token_type: "Bearer", expires_in: 60 },
      }),
    });

    const result = await refreshSession("rt-keep", { fetch: idp.fetch });

    expect(result.status === "ok" && result.tokens.refreshToken).toBe(
      "rt-keep",
    );
  });

  it("shares one upstream call between concurrent requests (rotation would reject the second)", async () => {
    const idp = createFakeIdp({ onToken: () => ({ body: tokenBody }) });

    const results = await Promise.all([
      refreshSession("rt-concurrent", { fetch: idp.fetch }),
      refreshSession("rt-concurrent", { fetch: idp.fetch }),
      refreshSession("rt-concurrent", { fetch: idp.fetch }),
    ]);

    expect(idp.tokenCalls).toHaveLength(1);
    expect(new Set(results.map((r) => r.status))).toEqual(new Set(["ok"]));
  });

  it("reuses a fresh result for requests that were already on the wire with the old token", async () => {
    const idp = createFakeIdp({ onToken: () => ({ body: tokenBody }) });

    await refreshSession("rt-reuse", { fetch: idp.fetch });
    await refreshSession("rt-reuse", { fetch: idp.fetch });

    expect(idp.tokenCalls).toHaveLength(1);
  });

  it.each(["invalid_token", "unauthorized_client"])(
    "reports a definitive rejection for %s",
    async (error) => {
      const idp = createFakeIdp({
        onToken: () => ({ status: 400, body: { error } }),
      });

      await expect(
        refreshSession(`rt-${error}`, { fetch: idp.fetch }),
      ).resolves.toEqual({ status: "rejected" });
    },
  );

  describe("invalid_grant (the loser of a rotation race on another replica)", () => {
    const refused = () =>
      createFakeIdp({
        onToken: () => ({ status: 400, body: { error: "invalid_grant" } }),
      });

    it("is stale on first sight: the cookies must not be cleared", async () => {
      const idp = refused();

      await expect(
        refreshSession("rt-race-first", { fetch: idp.fetch }),
      ).resolves.toEqual({ status: "stale" });
    });

    it("does not hammer the IdP while the race window is open", async () => {
      vi.useFakeTimers();
      const idp = refused();

      await refreshSession("rt-race-cached", { fetch: idp.fetch });
      await vi.advanceTimersByTimeAsync(5_000);
      await expect(
        refreshSession("rt-race-cached", { fetch: idp.fetch }),
      ).resolves.toEqual({ status: "stale" });

      expect(idp.tokenCalls).toHaveLength(1);
    });

    it("is final once the same token is still refused after the window", async () => {
      vi.useFakeTimers();
      const idp = refused();

      await refreshSession("rt-race-dead", { fetch: idp.fetch });
      await vi.advanceTimersByTimeAsync(16_000);
      await expect(
        refreshSession("rt-race-dead", { fetch: idp.fetch }),
      ).resolves.toEqual({ status: "rejected" });
      expect(idp.tokenCalls).toHaveLength(2);
    });
  });

  describe("ID token on refresh", () => {
    const withIdToken = (idToken?: string) =>
      createFakeIdp({
        onToken: () => ({ body: { ...tokenBody, id_token: idToken } }),
      });

    it("keeps a correctly signed ID token", async () => {
      const signed = idToken();
      const result = await refreshSession("rt-id-ok", {
        fetch: withIdToken(signed).fetch,
      });

      expect(result.status === "ok" && result.tokens.idToken).toBe(signed);
    });

    it.each([
      [
        "signed by a foreign key",
        () => idToken({}, { key: foreignSigningKey }),
      ],
      ["with an unknown kid", () => idToken({}, { kid: "nope" })],
      ["alg none", () => idToken({}, { alg: "none" })],
    ])("ends the session for an ID token %s", async (name, make) => {
      await expect(
        refreshSession(`rt-id-bad-${name}`, {
          fetch: withIdToken(make()).fetch,
        }),
      ).resolves.toEqual({ status: "rejected" });
    });
  });

  it("never adopts tokens whose ID token names another issuer (the session is left as it was)", async () => {
    const idp = createFakeIdp({
      onToken: () => ({
        body: {
          ...tokenBody,
          id_token: idToken({ iss: "https://evil.example" }),
        },
      }),
    });

    await expect(
      refreshSession("rt-id-bad-iss", { fetch: idp.fetch }),
    ).resolves.toEqual({ status: "unavailable" });
  });

  it("treats a response without an access token as a rejection, never an empty session", async () => {
    const idp = createFakeIdp({
      onToken: () => ({ body: { token_type: "Bearer" } }),
    });

    const result = await refreshSession("rt-empty", { fetch: idp.fetch });

    expect(result.status).not.toBe("ok");
  });

  it("does not call an IdP outage a sign-out", async () => {
    const idp = createFakeIdp({
      onToken: () => ({
        status: 503,
        body: { error: "temporarily_unavailable" },
      }),
    });

    await expect(
      refreshSession("rt-outage", { fetch: idp.fetch }),
    ).resolves.toEqual({ status: "unavailable" });
  });

  it("does not call an unreachable IdP a sign-out", async () => {
    const offline = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;

    await expect(
      refreshSession("rt-offline", { fetch: offline }),
    ).resolves.toEqual({ status: "unavailable" });
  });
});
