import type { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";

import {
  ACCESS_COOKIE,
  type CookieWriter,
  clearSessionCookies,
  ID_COOKIE,
  REFRESH_COOKIE,
  writeSessionCookies,
} from "@/shared/lib/auth/session-cookies";
import { classifySession, type SessionState } from "./security/route-guard";
import type { AppBindings, AuthDeps } from "./types";

type Ctx = Context<AppBindings>;

/** Adapts Hono's cookie helper to the `CookieWriter` the shared kit writes through. */
export function cookieJar(c: Ctx): CookieWriter {
  return {
    set(name, value, options) {
      setCookie(c, name, value, {
        httpOnly: options?.httpOnly,
        secure: options?.secure,
        sameSite: "Lax",
        path: options?.path,
        maxAge: options?.maxAge,
      });
    },
  };
}

export type ResolvedSession = {
  state: SessionState;
  /** The access token to read roles from (a rotated one when refreshed). */
  accessToken: string | undefined;
  idToken: string | undefined;
  /** Why a "refreshable" session stayed so: the IdP could not be reached. */
  idpUnavailable: boolean;
};

/**
 * Resolves the session from the request cookies, rotating an expired access
 * token through the refresh cookie (single-flight inside `refreshSession`) and
 * writing the new cookies onto the response being built. A rejected refresh
 * clears the session; a "stale" one (lost a rotation race) is signed out for
 * this request only; "unavailable" keeps the stale session, because an IdP
 * outage must not sign users out.
 */
export async function resolveSession(
  c: Ctx,
  auth: Pick<AuthDeps, "refreshSession">,
  fetchImpl: typeof fetch,
): Promise<ResolvedSession> {
  let accessToken = getCookie(c, ACCESS_COOKIE);
  const refreshToken = getCookie(c, REFRESH_COOKIE);
  let idToken = getCookie(c, ID_COOKIE);
  let state = classifySession({ accessToken, refreshToken });
  let idpUnavailable = false;

  if (state === "refreshable") {
    const result = await auth.refreshSession(refreshToken ?? "", {
      fetch: fetchImpl,
    });
    if (result.status === "ok") {
      writeSessionCookies(cookieJar(c), result.tokens);
      accessToken = result.tokens.accessToken;
      idToken = result.tokens.idToken ?? idToken;
      state = "active";
    } else if (result.status === "rejected") {
      clearSessionCookies(cookieJar(c));
      state = "anonymous";
    } else if (result.status === "stale") {
      // Probably lost a rotation race to another replica: signed out for this
      // request, cookies left untouched.
      state = "anonymous";
    } else {
      idpUnavailable = true;
    }
  }
  return { state, accessToken, idToken, idpUnavailable };
}
