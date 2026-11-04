import { clientEnv } from "@/shared/env/client";
import { edgeEnv } from "@/shared/env/edge";

/**
 * The session lives in httpOnly cookies set only by this app's server
 * side (the OIDC callback, Server Actions, the RPC proxy, `proxy.ts`) — page JavaScript never
 * sees a token, so an XSS can ride the session but can't exfiltrate it.
 *
 * `__Host-` (Secure + Path=/ + no Domain) is added whenever the site is
 * served over HTTPS; on plain-HTTP localhost browsers reject Secure
 * cookies, so dev uses the bare names.
 */
const BASE_NAME = edgeEnv.AUTH_COOKIE_NAME;

export const isSecureSite = clientEnv.NEXT_PUBLIC_SITE_URL.startsWith("https:");
const prefix = isSecureSite ? "__Host-" : "";

export const ACCESS_COOKIE = `${prefix}${BASE_NAME}`;
export const REFRESH_COOKIE = `${prefix}${BASE_NAME}_refresh`;
/** The OIDC ID token: who is signed in (display) and `id_token_hint` at logout. */
export const ID_COOKIE = `${prefix}${BASE_NAME}_id`;

/**
 * The IdP does not tell us when a refresh token dies (it is opaque), so the
 * cookie just outlives any sane IdP policy; a dead token is discovered by the
 * refresh grant being rejected, which then clears the session.
 */
export const REFRESH_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export type SessionTokens = {
  accessToken: string;
  refreshToken: string;
  accessMaxAgeSeconds: number;
  refreshMaxAgeSeconds: number;
  /** Absent when the IdP issued none (a refresh response may omit it). */
  idToken?: string;
};

type CookieOptions = {
  httpOnly: boolean;
  secure: boolean;
  sameSite: "lax";
  path: string;
  maxAge: number;
};

/** The subset of `cookies()` / `NextResponse.cookies` this module writes through. */
export type CookieWriter = {
  set(name: string, value: string, options?: CookieOptions): unknown;
};

function baseOptions(maxAge: number): CookieOptions {
  return {
    httpOnly: true,
    secure: isSecureSite,
    sameSite: "lax",
    path: "/",
    maxAge,
  };
}

export function writeSessionCookies(
  jar: CookieWriter,
  tokens: SessionTokens,
): void {
  jar.set(
    ACCESS_COOKIE,
    tokens.accessToken,
    baseOptions(tokens.accessMaxAgeSeconds),
  );
  jar.set(
    REFRESH_COOKIE,
    tokens.refreshToken,
    baseOptions(tokens.refreshMaxAgeSeconds),
  );
  // Keep the previous ID token when a refresh response did not carry one.
  if (tokens.idToken) {
    jar.set(
      ID_COOKIE,
      tokens.idToken,
      baseOptions(tokens.refreshMaxAgeSeconds),
    );
  }
}

/**
 * Drops only the access token. Safe even when a concurrent refresh on another
 * replica is setting fresh cookies: the refresh cookie survives, so the next
 * request simply refreshes again.
 */
export function clearAccessCookie(jar: CookieWriter): void {
  jar.set(ACCESS_COOKIE, "", baseOptions(0));
}

export function clearSessionCookies(jar: CookieWriter): void {
  jar.set(ACCESS_COOKIE, "", baseOptions(0));
  jar.set(REFRESH_COOKIE, "", baseOptions(0));
  jar.set(ID_COOKIE, "", baseOptions(0));
}
