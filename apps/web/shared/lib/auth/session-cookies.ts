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

/** Reads one request cookie by name (`undefined` when absent). */
export type CookieReader = (name: string) => string | undefined;

/**
 * A browser drops a cookie whose name, value and attributes exceed 4096
 * bytes, silently. A token with many role grants can be larger, so a value
 * over `MAX_CHUNK_LENGTH` is split across numbered cookies (`name.0`,
 * `name.1`, ...), each with the same `__Host-`, httpOnly, Secure and SameSite
 * attributes, and put back together on read. 3800 leaves room for the name
 * and the attributes under 4096.
 */
export const MAX_CHUNK_LENGTH = 3800;
/** Hard cap on the numbered cookies of one value. */
export const MAX_COOKIE_CHUNKS = 3;
/**
 * Cap on the three session values together: every request carries them in
 * one `Cookie` header, and servers and proxies limit header size (Node 16 KB
 * by default). Past this the session is refused, not truncated.
 */
export const MAX_SESSION_COOKIE_LENGTH = 12_000;

const chunkName = (name: string, index: number) => `${name}.${index}`;

/** The cookie length of a value: both frameworks percent-encode it. */
const encodedLength = (value: string) => encodeURIComponent(value).length;

/**
 * A value as the cookies that carry it: one cookie under `name` when it
 * fits, otherwise numbered chunks. `null` when it needs more than
 * `MAX_COOKIE_CHUNKS`.
 */
export function sessionCookieParts(
  name: string,
  value: string,
): { name: string; value: string }[] | null {
  if (encodedLength(value) <= MAX_CHUNK_LENGTH) {
    return [{ name, value }];
  }
  // Tokens are URL-safe (JWT, opaque ids), so a character is one byte; any
  // other value is cut small enough for the worst case of percent-encoding.
  const size =
    encodedLength(value) === value.length
      ? MAX_CHUNK_LENGTH
      : Math.floor(MAX_CHUNK_LENGTH / 9);
  const parts: { name: string; value: string }[] = [];
  for (let start = 0; start < value.length; start += size) {
    parts.push({
      name: chunkName(name, parts.length),
      value: value.slice(start, start + size),
    });
  }
  return parts.length <= MAX_COOKIE_CHUNKS ? parts : null;
}

/** Every cookie name a session value can occupy: the plain one and each chunk. */
export function sessionCookieNames(name: string): string[] {
  return [
    name,
    ...Array.from({ length: MAX_COOKIE_CHUNKS }, (_, index) =>
      chunkName(name, index),
    ),
  ];
}

/** A session value from the request cookies, whole or put back together. */
export function readSessionCookie(
  read: CookieReader,
  name: string,
): string | undefined {
  const whole = read(name);
  if (whole) {
    return whole;
  }
  let value = "";
  for (let index = 0; index < MAX_COOKIE_CHUNKS; index += 1) {
    const part = read(chunkName(name, index));
    if (!part) {
      break;
    }
    value += part;
  }
  return value || undefined;
}

function baseOptions(maxAge: number): CookieOptions {
  return {
    httpOnly: true,
    secure: isSecureSite,
    sameSite: "lax",
    path: "/",
    maxAge,
  };
}

/**
 * Writes one value and expires the other names it used before, so a smaller
 * value never leaves stale chunks of a larger one behind (and a chunked value
 * never leaves a stale whole cookie). `existing` reads the REQUEST cookies:
 * with it only names the browser really holds are expired; without it every
 * possible name is, which is always correct and only costs response headers.
 * Clearing (no parts) always expires the plain name.
 */
function setValue(
  jar: CookieWriter,
  name: string,
  parts: { name: string; value: string }[],
  maxAge: number,
  existing?: CookieReader,
): void {
  const used = new Set(parts.map((part) => part.name));
  for (const part of parts) {
    jar.set(part.name, part.value, baseOptions(maxAge));
  }
  for (const stale of sessionCookieNames(name)) {
    const held = existing ? existing(stale) !== undefined : true;
    const clearingPlainName = parts.length === 0 && stale === name;
    if (!used.has(stale) && (held || clearingPlainName)) {
      jar.set(stale, "", baseOptions(0));
    }
  }
}

/**
 * Stores the session. Returns `false`, with every session cookie cleared and
 * an error logged (names and sizes only, never token content), when a token
 * needs more than `MAX_COOKIE_CHUNKS` cookies or the three together exceed
 * `MAX_SESSION_COOKIE_LENGTH`: a session that cannot be stored whole is
 * refused, never truncated.
 */
export function writeSessionCookies(
  jar: CookieWriter,
  tokens: SessionTokens,
  existing?: CookieReader,
): boolean {
  const values = [
    {
      name: ACCESS_COOKIE,
      value: tokens.accessToken,
      maxAge: tokens.accessMaxAgeSeconds,
    },
    {
      name: REFRESH_COOKIE,
      value: tokens.refreshToken,
      maxAge: tokens.refreshMaxAgeSeconds,
    },
    // Keep the previous ID token when a refresh response did not carry one.
    ...(tokens.idToken
      ? [
          {
            name: ID_COOKIE,
            value: tokens.idToken,
            maxAge: tokens.refreshMaxAgeSeconds,
          },
        ]
      : []),
  ].map((entry) => ({
    ...entry,
    parts: sessionCookieParts(entry.name, entry.value),
  }));

  const total = values.reduce(
    (sum, entry) => sum + encodedLength(entry.value),
    0,
  );
  const tooLarge = values.find((entry) => entry.parts === null);
  if (tooLarge || total > MAX_SESSION_COOKIE_LENGTH) {
    // biome-ignore lint/suspicious/noConsole: server-side operational log; sizes and cookie names only, no token content
    console.error(
      "auth.session_cookie_too_large: the session was refused and cleared",
      {
        cookie: tooLarge?.name ?? "all",
        lengths: Object.fromEntries(
          values.map((entry) => [entry.name, encodedLength(entry.value)]),
        ),
        maxPerCookie: MAX_CHUNK_LENGTH * MAX_COOKIE_CHUNKS,
        maxTotal: MAX_SESSION_COOKIE_LENGTH,
      },
    );
    clearSessionCookies(jar, existing);
    return false;
  }
  for (const entry of values) {
    setValue(jar, entry.name, entry.parts ?? [], entry.maxAge, existing);
  }
  return true;
}

/**
 * Drops only the access token. Safe even when a concurrent refresh on another
 * replica is setting fresh cookies: the refresh cookie survives, so the next
 * request simply refreshes again.
 */
export function clearAccessCookie(
  jar: CookieWriter,
  existing?: CookieReader,
): void {
  setValue(jar, ACCESS_COOKIE, [], 0, existing);
}

export function clearSessionCookies(
  jar: CookieWriter,
  existing?: CookieReader,
): void {
  setValue(jar, ACCESS_COOKIE, [], 0, existing);
  setValue(jar, REFRESH_COOKIE, [], 0, existing);
  setValue(jar, ID_COOKIE, [], 0, existing);
}
