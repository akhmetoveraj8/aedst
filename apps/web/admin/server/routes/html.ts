import type { Context } from "hono";

import { decodeSessionRoles } from "@/shared/lib/auth/session-claims";
import { isAssetPath } from "../http/static";
import { errorFields } from "../logger";
import {
  buildContentSecurityPolicy,
  buildReportingEndpoints,
  buildTrustedTypesReportOnlyPolicy,
  generateNonce,
  sentryCspReportUri,
  sentryOrigin,
} from "../security/csp";
import { decideRoute } from "../security/route-guard";
import { resolveSession } from "../session";
import type { AppBindings, AppDeps } from "../types";

/** The placeholder Vite `html.cspNonce` leaves on script/style/link tags. */
const NONCE_PLACEHOLDER = "__CSP_NONCE__";

/**
 * Document navigations (replaces the Next `proxy.ts`):
 * 1. resolve the session, rotating an expired access token via the refresh
 *    cookie here (single-flight, cookies set on this response);
 * 2. guard: anonymous -> /api/auth/login?next=, signed in without an operator
 *    role -> /<locale>/forbidden (apps/server RoleInterceptor remains the
 *    real guard on every call);
 * 3. else index.html with every nonce placeholder replaced by a fresh nonce
 *    and the matching Content-Security-Policy.
 */
export function htmlHandler(deps: AppDeps) {
  const { env, auth, logger } = deps;
  const reportUri = sentryCspReportUri(env.SENTRY_DSN);
  const ingest = sentryOrigin(env.SENTRY_DSN);
  let cached: string | undefined;

  const loadTemplate = async (): Promise<string> => {
    if (cached !== undefined) {
      return cached;
    }
    const html = await deps.readIndexHtml();
    if (!html.includes(NONCE_PLACEHOLDER)) {
      logger.warn("html.no_nonce_placeholder");
    }
    // Dev rebuilds replace the file; only production keeps it in memory.
    if (env.isProduction) {
      cached = html;
    }
    return html;
  };

  return async (c: Context<AppBindings>) => {
    const url = new URL(c.req.url);
    if (isAssetPath(url.pathname)) {
      return c.text("Not found", 404);
    }

    const session = await resolveSession(c, auth, deps.fetch);
    const decision = decideRoute({
      pathname: url.pathname,
      search: url.search,
      session: session.state,
      roles:
        session.state !== "anonymous" && session.accessToken
          ? decodeSessionRoles(session.accessToken)
          : [],
    });

    const nonce = generateNonce();
    c.header(
      "content-security-policy",
      buildContentSecurityPolicy({
        nonce,
        isDev: !env.isProduction,
        upgradeInsecureRequests: env.isProduction && env.secureSite,
        reportUri,
        connectOrigins: ingest ? [ingest] : [],
      }),
    );
    if (reportUri) {
      c.header("reporting-endpoints", buildReportingEndpoints(reportUri));
      c.header(
        "content-security-policy-report-only",
        buildTrustedTypesReportOnlyPolicy(reportUri),
      );
    }
    c.header("cache-control", "no-store");

    if (decision.type === "redirect") {
      return c.redirect(decision.location, 302);
    }

    let template: string;
    try {
      template = await loadTemplate();
    } catch (error) {
      logger.error("html.index_missing", {
        requestId: c.get("requestId"),
        ...errorFields(error),
      });
      return c.text("The admin build is not available", 503);
    }
    return c.html(template.replaceAll(NONCE_PLACEHOLDER, nonce));
  };
}
