import "server-only";

import { cookies } from "next/headers";

import {
  decodeSessionClaims,
  decodeSessionIdentity,
  decodeSessionRoles,
  isAccessTokenExpired,
  type SessionIdentity,
} from "@/shared/lib/auth/session-claims";
import {
  ACCESS_COOKIE,
  ID_COOKIE,
  readSessionCookie,
} from "@/shared/lib/auth/session-cookies";

/**
 * The caller's access token from the httpOnly cookie, or `undefined` when
 * absent/expired. Refreshing is not done here: Server Components can't set
 * cookies, so `proxy.ts` (and the RPC route) rotate tokens before render.
 */
export async function getAccessToken(): Promise<string | undefined> {
  const jar = await cookies();
  const token = readSessionCookie(
    (name) => jar.get(name)?.value,
    ACCESS_COOKIE,
  );
  if (!token || isAccessTokenExpired(token)) {
    return undefined;
  }
  return token;
}

/** Unverified `sub` of the current access token — UI/Sentry context only. */
export async function getSessionUserId(): Promise<string | undefined> {
  const token = await getAccessToken();
  return token ? decodeSessionClaims(token)?.sub : undefined;
}

/**
 * Unverified roles of the current access token — for rendering decisions
 * only (show the admin link, render the admin area). apps/server enforces
 * every role through its RoleInterceptor policy.
 */
export async function getSessionRoles(): Promise<string[]> {
  const token = await getAccessToken();
  return token ? decodeSessionRoles(token) : [];
}

/** Display identity from the ID token cookie (unverified; UI only). */
export async function getSessionIdentity(): Promise<SessionIdentity | null> {
  const jar = await cookies();
  const idToken = readSessionCookie((name) => jar.get(name)?.value, ID_COOKIE);
  return idToken ? decodeSessionIdentity(idToken) : null;
}
