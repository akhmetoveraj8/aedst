import { describe, expect, it } from "vitest";

import {
  openPreAuth,
  type PreAuthState,
  sealPreAuth,
} from "@/shared/lib/auth/oidc/pre-auth-cookie";

const SECRET = "a-secret-that-is-at-least-32-characters-long";
const state: PreAuthState = {
  state: "s",
  nonce: "n",
  codeVerifier: "v".repeat(43),
  next: "/tasks",
};

describe("pre-auth cookie", () => {
  it("round-trips the login state", () => {
    expect(openPreAuth(sealPreAuth(state, SECRET), SECRET)).toEqual(state);
  });

  it("does not reveal the PKCE verifier to the browser", () => {
    const sealed = sealPreAuth(state, SECRET);

    expect(sealed).not.toContain(state.codeVerifier);
    expect(Buffer.from(sealed, "base64url").toString("utf8")).not.toContain(
      state.codeVerifier,
    );
  });

  it("produces a different cookie each time (random IV)", () => {
    expect(sealPreAuth(state, SECRET)).not.toBe(sealPreAuth(state, SECRET));
  });

  it("rejects a cookie sealed with another secret", () => {
    const sealed = sealPreAuth(state, SECRET);

    expect(openPreAuth(sealed, `${SECRET}-other`)).toBeNull();
  });

  it("rejects a tampered cookie", () => {
    const bytes = Buffer.from(sealPreAuth(state, SECRET), "base64url");
    bytes[bytes.length - 1] = (bytes.at(-1) ?? 0) ^ 1;

    expect(openPreAuth(bytes.toString("base64url"), SECRET)).toBeNull();
  });

  it("rejects an expired cookie", () => {
    const now = 1_700_000_000_000;
    const sealed = sealPreAuth(state, SECRET, now);

    expect(openPreAuth(sealed, SECRET, now + 599_000)).toEqual(state);
    expect(openPreAuth(sealed, SECRET, now + 601_000)).toBeNull();
  });

  it.each([undefined, "", "short", "not base64 !!!"])(
    "rejects missing or malformed input %j",
    (value) => {
      expect(openPreAuth(value, SECRET)).toBeNull();
    },
  );
});
