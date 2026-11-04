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
 * Admin sign-out as a Server Action (Next's built-in Origin check is its CSRF
 * protection). It ends only the admin session: the app project keeps its own
 * cookies and OIDC client, so signing out here does not sign out there.
 */

export type LogoutResult = {
  /** The IdP's RP-initiated logout URL to navigate to, or `null` if none. */
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
