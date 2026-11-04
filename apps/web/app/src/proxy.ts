import { NextRequest, NextResponse } from "next/server";
import createMiddleware from "next-intl/middleware";
import { disabledRoutePrefixes } from "@/app/config/modules/registry";
import {
  buildApiContentSecurityPolicy,
  buildContentSecurityPolicy,
  buildReportingEndpoints,
  buildServiceWorkerContentSecurityPolicy,
  buildTrustedTypesReportOnlyPolicy,
  generateNonce,
  parseOrigins,
  sentryCspReportUri,
} from "@/app/config/security/csp";
import {
  classifySession,
  decideRoute,
  type SessionState,
} from "@/app/config/security/route-guard";
import { withoutTrailingSlash } from "@/app/config/trailing-slash";
import { clientEnv, isProduction } from "@/shared/env/client";
import { edgeEnv } from "@/shared/env/edge";
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
import { getServerCapabilities } from "@/shared/lib/capabilities/server";

const handleI18nRouting = createMiddleware(routing);

const mediaOrigins = parseOrigins(edgeEnv.MEDIA_ORIGINS);
const cspReportUri = sentryCspReportUri(clientEnv.NEXT_PUBLIC_SENTRY_DSN);

function withContentSecurityPolicy(policy: string): NextResponse {
  const response = NextResponse.next();
  response.headers.set("content-security-policy", policy);
  return response;
}

/**
 * Per-request pipeline for page routes:
 * 1. mint a CSP nonce (Next stamps it onto its scripts during render);
 * 2. resolve the session — rotating an expired access token via the refresh
 *    cookie *here*, because Server Components cannot set cookies;
 * 3. guard protected pages / skip the login page for signed-in users;
 * 4. delegate locale negotiation to next-intl.
 */
export default async function proxy(request: NextRequest) {
  // Non-document routes: no session, no locale, no nonce - only the (static)
  // CSP, so this file stays the one place a CSP header is emitted.
  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/api/")) {
    return withContentSecurityPolicy(buildApiContentSecurityPolicy());
  }
  if (pathname.startsWith("/serwist/")) {
    return withContentSecurityPolicy(buildServiceWorkerContentSecurityPolicy());
  }

  // One URL per page: `/en/` -> `/en` (308), so canonical links never point
  // at a redirecting form. `skipTrailingSlashRedirect` turned Next's own off.
  const canonicalPath = withoutTrailingSlash(pathname);
  if (canonicalPath) {
    return NextResponse.redirect(
      new URL(`${canonicalPath}${request.nextUrl.search}`, request.url),
      308,
    );
  }

  const nonce = generateNonce();
  const csp = buildContentSecurityPolicy({
    nonce,
    isDev: !isProduction,
    upgradeInsecureRequests: isProduction && isSecureSite,
    mediaOrigins,
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
      // Probably lost a rotation race to another replica whose cookies are on
      // their way: signed out for this request, cookies left untouched.
      session = "anonymous";
    }
    // "unavailable": apps/server is down — do not sign the user out for it.
  }

  const accessToken = request.cookies.get(ACCESS_COOKIE)?.value;
  // Cached per process (TTL), so this is not a network call per request.
  const disabledPrefixes = disabledRoutePrefixes(await getServerCapabilities());
  const decision = decideRoute({
    disabledPrefixes,
    pathname: request.nextUrl.pathname,
    search: request.nextUrl.search,
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
  // `api` and `serwist` take the CSP-only branch at the top of `proxy`;
  // `monitoring` is Sentry's `tunnelRoute` and `ingest` the PostHog reverse
  // proxy (next-intl would 30x-redirect them to add a locale prefix and break
  // them, see next.config.ts); prefetches are skipped so `<Link>` hover does
  // not mint nonces or rotate tokens.
  matcher: [
    // CSP-only branches at the top of `proxy` (no session, no locale).
    "/api/:path*",
    "/serwist/:path*",
    {
      source:
        "/((?!api|trpc|_next|_vercel|monitoring|ingest|serwist|offline|.*\\..*).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
