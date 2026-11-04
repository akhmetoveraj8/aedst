"use server";

import { cookies } from "next/headers";

import { getOidcConfig } from "@/shared/lib/auth/oidc/config";
import {
  buildEndSessionUrl,
  revokeRefreshToken,
} from "@/shared/lib/auth/oidc/login-flow";
import {
  clearSessionCookies,
  ID_COOKIE,
  REFRESH_COOKIE,
} from "@/shared/lib/auth/session-cookies";

/**
 * Sign-out as a Server Action, so it carries Next's built-in Origin check
 * (CSRF protection for this mutation). Sign-in is not here: it is the
 * OpenID Connect redirect flow in `app/api/auth/{login,callback}`.
 */

export type LogoutResult = {
  /**
   * The IdP's RP-initiated logout URL (`id_token_hint` +
   * `post_logout_redirect_uri`) to navigate the browser to, or `null` when
   * the IdP has none and the local sign-out is complete.
   */
  endSessionUrl: string | null;
};

export async function logoutAction(): Promise<LogoutResult> {
  const jar = await cookies();
  const refreshToken = jar.get(REFRESH_COOKIE)?.value;
  const idToken = jar.get(ID_COOKIE)?.value;
  // Always first: whatever happens at the IdP, this browser is signed out.
  clearSessionCookies(jar);

  try {
    const config = getOidcConfig();
    if (refreshToken) {
      await revokeRefreshToken({ config, refreshToken });
    }
    return { endSessionUrl: await buildEndSessionUrl({ config, idToken }) };
  } catch {
    return { endSessionUrl: null };
  }
}
