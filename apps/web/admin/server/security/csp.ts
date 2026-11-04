/**
 * Strict, nonce-based Content-Security-Policy for the admin panel, built per
 * request by the BFF's HTML route. The Vite build marks its script/style/link
 * tags with the placeholder `__CSP_NONCE__` (`html.cspNonce`); the BFF swaps
 * it for the request's nonce, which is what lets `script-src` drop
 * `'unsafe-inline'`; `'strict-dynamic'` lets those trusted scripts load their
 * own chunks without a host allowlist.
 *
 * Trimmed copy of the app project's policy: the admin panel has no media
 * uploads (no object-storage origins), no service worker and no PostHog. The
 * browser talks to this origin only: apps/server is reached through the
 * same-origin `/api/rpc` proxy; the one exception is the Sentry ingest origin
 * derived from the DSN.
 *
 * `style-src` keeps `'unsafe-inline'`: React/Base UI/Tailwind emit inline
 * style attributes that a nonce cannot cover.
 */

export function generateNonce(): string {
  return btoa(crypto.randomUUID());
}

/**
 * Sentry's CSP report endpoint for a DSN
 * (`https://<key>@o1.ingest.sentry.io/<project>` ->
 * `https://o1.ingest.sentry.io/api/<project>/security/?sentry_key=<key>`).
 * Violation reports are sent by the browser itself, so this needs no
 * `connect-src` entry.
 */
export function sentryCspReportUri(dsn: string | undefined): string | null {
  if (!dsn) {
    return null;
  }
  try {
    const url = new URL(dsn);
    const projectId = url.pathname.replace(/^\/+/, "");
    if (!url.username || !projectId) {
      return null;
    }
    return `${url.protocol}//${url.host}/api/${projectId}/security/?sentry_key=${url.username}`;
  } catch {
    return null;
  }
}

/**
 * Origin of the Sentry ingest host for a DSN: the browser SDK posts events
 * there directly (there is no same-origin tunnel), so `connect-src` lists it.
 */
export function sentryOrigin(dsn: string | undefined): string | null {
  if (!dsn) {
    return null;
  }
  try {
    return new URL(dsn).origin;
  } catch {
    return null;
  }
}

/** Name of the Reporting API endpoint (`Reporting-Endpoints` header, CSP `report-to`). */
const CSP_REPORTING_ENDPOINT = "csp-endpoint";

/**
 * `report-uri` (all engines) next to `report-to` (Reporting API, Chromium): a
 * browser that understands `report-to` ignores `report-uri`, the rest fall back.
 */
function reportDirectives(reportUri: string | null | undefined): string[] {
  return reportUri
    ? [`report-uri ${reportUri}`, `report-to ${CSP_REPORTING_ENDPOINT}`]
    : [];
}

/** Value of the `Reporting-Endpoints` response header. */
export function buildReportingEndpoints(reportUri: string): string {
  return `${CSP_REPORTING_ENDPOINT}="${reportUri}"`;
}

export function buildContentSecurityPolicy({
  nonce,
  isDev,
  upgradeInsecureRequests = !isDev,
  reportUri = null,
  connectOrigins = [],
}: {
  nonce: string;
  isDev: boolean;
  /**
   * Only meaningful when the site is served over HTTPS. Over plain HTTP
   * (a production build under test on 127.0.0.1) WebKit really does rewrite
   * every subresource to https:// and the page breaks.
   */
  upgradeInsecureRequests?: boolean;
  /** Where browsers send violation reports (`sentryCspReportUri`). */
  reportUri?: string | null;
  /** Extra `connect-src` origins: the Sentry ingest origin (`sentryOrigin`). */
  connectOrigins?: readonly string[];
}): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    `connect-src ${["'self'", ...connectOrigins, ...(isDev ? ["ws:"] : [])].join(" ")}`,
    "manifest-src 'none'",
    "worker-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(upgradeInsecureRequests ? ["upgrade-insecure-requests"] : []),
    ...reportDirectives(reportUri),
  ].join("; ");
}

/**
 * Trusted Types, in **report-only** mode: DOM XSS sinks assigned a plain
 * string are reported, not blocked (same stance as the app project).
 */
export function buildTrustedTypesReportOnlyPolicy(
  reportUri: string | null,
): string {
  return [
    "require-trusted-types-for 'script'",
    ...reportDirectives(reportUri),
  ].join("; ");
}

/**
 * Policy for routes that never render a document (`/api/*` JSON responses
 * and redirects): nothing may load, nothing may frame them.
 */
export function buildApiContentSecurityPolicy(): string {
  return "default-src 'none'; frame-ancestors 'none'";
}
