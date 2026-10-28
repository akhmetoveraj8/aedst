import { NextResponse } from "next/server";

import { clientEnv } from "@/shared/env/client";
import { getOidcConfig } from "@/shared/lib/auth/oidc/config";
import { startLogin } from "@/shared/lib/auth/oidc/login-flow";
import {
  PRE_AUTH_COOKIE,
  PRE_AUTH_MAX_AGE_SECONDS,
} from "@/shared/lib/auth/oidc/pre-auth-cookie";
import { isSecureSite } from "@/shared/lib/auth/session-cookies";
import { reportError } from "@/shared/lib/errors/report-error";

/**
 * Starts the admin panel's own OpenID Connect Authorization Code + PKCE flow
 * (admin is a separate OIDC client from the app project; ZITADEL SSO makes
 * the IdP step seamless for a user already signed in there). `?next=` is the
 * post-login destination, validated by `startLogin`.
 * A plain GET on purpose: it only ever redirects to the IdP, and the
 * callback's state check ties the answer to this browser.
 */
export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  try {
    const { location, sealed } = await startLogin({
      config: getOidcConfig(),
      next: params.get("next"),
      register: false,
    });
    const response = NextResponse.redirect(location);
    response.cookies.set(PRE_AUTH_COOKIE, sealed, {
      httpOnly: true,
      secure: isSecureSite,
      // Lax, not Strict: the IdP's redirect back is a cross-site top-level GET.
      sameSite: "lax",
      path: "/",
      maxAge: PRE_AUTH_MAX_AGE_SECONDS,
    });
    response.headers.set("cache-control", "no-store");
    return response;
  } catch (error) {
    reportError(error, { source: "bff", feature: "auth" });
    const reason = error instanceof Error && error.name === "OidcConfigError";
    // /forbidden is exempt from the sign-in guard, so a failing IdP cannot
    // cause a redirect loop between the proxy and this handler.
    const failure = new URL("/forbidden", clientEnv.NEXT_PUBLIC_SITE_URL);
    failure.searchParams.set("auth_error", reason ? "config" : "unavailable");
    return NextResponse.redirect(failure);
  }
}
