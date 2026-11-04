import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";

import { isSecureSite } from "@/shared/lib/auth/session-cookies";

/**
 * Everything the callback needs to finish one login and to reject anything
 * that is not the answer to it. Sealed (AES-256-GCM) so the browser can
 * neither read the PKCE verifier nor forge or splice a state, and httpOnly +
 * short-lived so it only exists for the round trip to the IdP.
 */
export type PreAuthState = {
  state: string;
  nonce: string;
  codeVerifier: string;
  /** Already passed through `safeRedirectPath`. */
  next: string;
};

export const PRE_AUTH_COOKIE = `${isSecureSite ? "__Host-" : ""}aedst_oidc`;
export const PRE_AUTH_MAX_AGE_SECONDS = 600;

type Sealed = PreAuthState & { exp: number };

const IV_BYTES = 12;
const TAG_BYTES = 16;

function key(secret: string): Buffer {
  return Buffer.from(
    hkdfSync("sha256", secret, "", "aedst-oidc-pre-auth-v1", 32),
  );
}

export function sealPreAuth(
  payload: PreAuthState,
  secret: string,
  nowMs: number = Date.now(),
): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key(secret), iv);
  const body: Sealed = {
    ...payload,
    exp: nowMs + PRE_AUTH_MAX_AGE_SECONDS * 1000,
  };
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(body), "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString(
    "base64url",
  );
}

/** The payload, or `null` when absent, tampered with, sealed with another key or expired. */
export function openPreAuth(
  value: string | undefined,
  secret: string,
  nowMs: number = Date.now(),
): PreAuthState | null {
  if (!value) {
    return null;
  }
  try {
    const raw = Buffer.from(value, "base64url");
    if (raw.length <= IV_BYTES + TAG_BYTES) {
      return null;
    }
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key(secret),
      raw.subarray(0, IV_BYTES),
    );
    decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
    const json = Buffer.concat([
      decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)),
      decipher.final(),
    ]).toString("utf8");
    const parsed = JSON.parse(json) as Partial<Sealed>;
    if (
      typeof parsed.state !== "string" ||
      typeof parsed.nonce !== "string" ||
      typeof parsed.codeVerifier !== "string" ||
      typeof parsed.next !== "string" ||
      typeof parsed.exp !== "number" ||
      parsed.exp <= nowMs
    ) {
      return null;
    }
    return {
      state: parsed.state,
      nonce: parsed.nonce,
      codeVerifier: parsed.codeVerifier,
      next: parsed.next,
    };
  } catch {
    return null;
  }
}
