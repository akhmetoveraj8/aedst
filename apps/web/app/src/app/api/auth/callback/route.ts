import { type NextRequest, NextResponse } from "next/server";

import { clientEnv } from "@/shared/env/client";
import { getOidcConfig, OidcConfigError } from "@/shared/lib/auth/oidc/config";
import { completeLogin } from "@/shared/lib/auth/oidc/login-flow";
import { PRE_AUTH_COOKIE } from "@/shared/lib/auth/oidc/pre-auth-cookie";
import {
  clearSessionCookies,
  isSecureSite,
  writeSessionCookies,
} from "@/shared/lib/auth/session-cookies";
import { reportError } from "@/shared/lib/errors/report-error";

/**
 * The OIDC redirect URI: validates the IdP's answer against the sealed
 * pre-auth cookie (state, PKCE verifier, nonce), exchanges the code, and
 * stores the tokens in the httpOnly session cookies. Every failure lands on
 * the login page with a coarse `?auth_error=` code; details never reach the
 * page. The pre-auth cookie is single-use: it is cleared on every outcome.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const site = clientEnv.NEXT_PUBLIC_SITE_URL;
  const read = (name: string) => request.cookies.get(name)?.value;
  const sealed = read(PRE_AUTH_COOKIE);

  let response: NextResponse;
  try {
    const result = await completeLogin({
      config: getOidcConfig(),
      callbackUrl: new URL(request.url),
      sealed,
    });
    if (result.ok) {
      // Locale-less on purpose: proxy.ts (next-intl) adds the visitor's locale.
      response = NextResponse.redirect(new URL(result.next, site));
      if (!writeSessionCookies(response.cookies, result.tokens, read)) {
        // The tokens do not fit the session cookies (logged there): refuse the
        // sign-in instead of looping between the app and the IdP.
        const failure = new URL("/", site);
        failure.searchParams.set("auth_error", "config");
        response = NextResponse.redirect(failure);
        clearSessionCookies(response.cookies, read);
      }
    } else {
      const failure = new URL("/", site);
      failure.searchParams.set("auth_error", result.reason);
      if (result.next) {
        failure.searchParams.set("next", result.next);
      }
      response = NextResponse.redirect(failure);
    }
  } catch (error) {
    reportError(error, { source: "bff", feature: "auth" });
    const failure = new URL("/", site);
    failure.searchParams.set(
      "auth_error",
      error instanceof OidcConfigError ? "config" : "unavailable",
    );
    response = NextResponse.redirect(failure);
  }

  response.cookies.set(PRE_AUTH_COOKIE, "", {
    httpOnly: true,
    secure: isSecureSite,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  response.headers.set("cache-control", "no-store");
  return response;
}
