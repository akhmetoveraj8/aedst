import { NextRequest, NextResponse } from "next/server";
import createMiddleware from "next-intl/middleware";
import {
  buildApiContentSecurityPolicy,
  buildContentSecurityPolicy,
  buildReportingEndpoints,
  buildTrustedTypesReportOnlyPolicy,
  generateNonce,
  sentryCspReportUri,
} from "@/app/config/security/csp";
import {
  classifySession,
  decideRoute,
  type SessionState,
} from "@/app/config/security/route-guard";
import { clientEnv, isProduction } from "@/shared/env/client";
import { routing } from "@/shared/i18n/routing";
import { refreshSession } from "@/shared/lib/auth/refresh-session";
import { decodeSessionRoles } from "@/shared/lib/auth/session-claims";
import {
  ACCESS_COOKIE,
  clearSessionCookies,
  isSecureSite,
  REFRESH_COOKIE,
  type SessionTokens,
  writeSessionCookies,
} from "@/shared/lib/auth/session-cookies";

const handleI18nRouting = createMiddleware(routing);

const cspReportUri = sentryCspReportUri(clientEnv.NEXT_PUBLIC_SENTRY_DSN);

/**
 * Per-request pipeline for admin pages:
 * 1. mint a CSP nonce (Next stamps it onto its scripts during render);
 * 2. resolve the session, rotating an expired access token via the refresh
 *    cookie here (Server Components cannot set cookies);
 * 3. guard: anonymous -> admin's own /api/auth/login, non-admin -> /forbidden;
 * 4. delegate locale negotiation to next-intl.
 * apps/server's RoleInterceptor remains the real guard on every call.
 */
export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // Non-document routes: no session, no locale, no nonce, only the static CSP.
  if (pathname.startsWith("/api/")) {
    const response = NextResponse.next();
    response.headers.set(
      "content-security-policy",
      buildApiContentSecurityPolicy(),
    );
    return response;
  }

  const nonce = generateNonce();
  const csp = buildContentSecurityPolicy({
    nonce,
    isDev: !isProduction,
    upgradeInsecureRequests: isProduction && isSecureSite,
    reportUri: cspReportUri,
  });

  let session: SessionState = classifySession({
    accessToken: request.cookies.get(ACCESS_COOKIE)?.value,
    refreshToken: request.cookies.get(REFRESH_COOKIE)?.value,
  });
  let rotated: SessionTokens | null = null;
  let ended = false;

  if (session === "refreshable") {
    const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value ?? "";
    const result = await refreshSession(refreshToken);
    if (result.status === "ok") {
      rotated = result.tokens;
      session = "active";
      // Make the fresh token visible to this same request's Server Components.
      request.cookies.set(ACCESS_COOKIE, result.tokens.accessToken);
      request.cookies.set(REFRESH_COOKIE, result.tokens.refreshToken);
    } else if (result.status === "rejected") {
      ended = true;
      session = "anonymous";
    } else if (result.status === "stale") {
      // Probably lost a rotation race to another replica: signed out for this
      // request, cookies left untouched.
      session = "anonymous";
    }
    // "unavailable": apps/server is down, do not sign the user out for it.
  }

  const accessToken = request.cookies.get(ACCESS_COOKIE)?.value;
  const decision = decideRoute({
    pathname,
    session,
    roles:
      session !== "anonymous" && accessToken
        ? decodeSessionRoles(accessToken)
        : [],
  });

  let response: NextResponse;
  if (decision.type === "redirect") {
    response = NextResponse.redirect(new URL(decision.location, request.url));
  } else {
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-nonce", nonce);
    requestHeaders.set("content-security-policy", csp);
    response = handleI18nRouting(
      new NextRequest(request, { headers: requestHeaders }),
    );
  }

  response.headers.set("content-security-policy", csp);
  // Belt and braces next to the metadata robots tag: no admin response is indexable.
  response.headers.set("x-robots-tag", "noindex, nofollow");
  if (cspReportUri) {
    response.headers.set(
      "reporting-endpoints",
      buildReportingEndpoints(cspReportUri),
    );
    response.headers.set(
      "content-security-policy-report-only",
      buildTrustedTypesReportOnlyPolicy(cspReportUri),
    );
  }
  if (rotated) {
    writeSessionCookies(response.cookies, rotated);
  } else if (ended) {
    clearSessionCookies(response.cookies);
  }
  return response;
}

export const config = {
  // `api` takes the CSP-only branch at the top of `proxy`; `monitoring` is
  // Sentry's `tunnelRoute` (next-intl would redirect it to add a locale
  // prefix); prefetches are skipped so `<Link>` hover does not mint nonces or
  // rotate tokens.
  matcher: [
    "/api/:path*",
    {
      source: "/((?!api|trpc|_next|_vercel|monitoring|.*\\..*).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
