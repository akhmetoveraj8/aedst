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
 * Starts the OpenID Connect Authorization Code + PKCE flow: remembers
 * verifier/state/nonce/destination in a sealed httpOnly cookie and sends the
 * browser to the IdP. `?next=` is the post-login destination (validated by
 * `startLogin`); `?screen_hint=register` opens the IdP's registration form.
 * A plain GET on purpose: it only ever redirects to the IdP, and the
 * callback's state check ties the answer to this browser.
 */
export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  try {
    const { location, sealed } = await startLogin({
      config: getOidcConfig(),
      next: params.get("next"),
      register: params.get("screen_hint") === "register",
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
    // An IdP outage or misconfiguration must be visible, not just a redirect.
    reportError(error, { source: "bff", feature: "auth" });
    const reason = error instanceof Error && error.name === "OidcConfigError";
    const failure = new URL("/", clientEnv.NEXT_PUBLIC_SITE_URL);
    failure.searchParams.set("auth_error", reason ? "config" : "unavailable");
    return NextResponse.redirect(failure);
  }
}
