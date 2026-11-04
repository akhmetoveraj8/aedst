import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { siteConfig } from "@/app/config/seo";
import { serverEnv } from "@/shared/env/server";
import { refreshSession } from "@/shared/lib/auth/refresh-session";
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
} from "@/shared/lib/auth/session-cookies";
import { applySessionCookieAction, proxyRpc } from "@/shared/lib/bff/rpc-proxy";
import { reportError } from "@/shared/lib/errors/report-error";

/**
 * The browser's only door to apps/server (backend-for-frontend). The whole
 * proxy (origin check, allowlist, bounded body, forwarding, session refresh)
 * is `shared/lib/bff/rpc-proxy.ts`, shared with the admin BFF; this file only
 * adapts it to Next.js cookies and responses.
 */

// Only the app's own services. There is no AuthService here: sign-in, refresh
// and sign-out are OpenID Connect against the IdP (app/api/auth, proxy.ts),
// and no token ever travels through this proxy in a response. AdminService
// belongs to the admin BFF and is refused here.
const ALLOWED_PROCEDURE =
  /^aedst\.(?:tasks|notifications|search|media|capabilities)\.v1\.[A-Za-z]+Service\/[A-Za-z]+$/;

export async function POST(
  request: Request,
  { params }: RouteContext<"/api/rpc/[...path]">,
): Promise<Response> {
  const jar = await cookies();
  const { response, cookies: action } = await proxyRpc(
    {
      origin: siteConfig.url.origin,
      isAllowedProcedure: (procedure) => ALLOWED_PROCEDURE.test(procedure),
      apiBaseUrl: serverEnv.API_BASE_URL,
      refreshSession: (refreshToken) => refreshSession(refreshToken),
      onUpstreamError: (error, procedure) =>
        reportError(error, { source: "bff", procedure }),
    },
    {
      request,
      procedure: (await params).path.join("/"),
      accessToken: jar.get(ACCESS_COOKIE)?.value,
      refreshToken: jar.get(REFRESH_COOKIE)?.value,
    },
  );
  const out = new NextResponse(response.body, {
    status: response.status,
    headers: response.headers,
  });
  applySessionCookieAction(out.cookies, action);
  return out;
}
