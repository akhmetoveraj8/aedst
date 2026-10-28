/**
 * Strict, nonce-based Content-Security-Policy, built per request by
 * `proxy.ts`. Next.js reads the nonce from the request's CSP header and
 * stamps it on its own scripts, which is what lets `script-src` drop
 * `'unsafe-inline'` — an injected inline `<script>` no longer executes.
 * `'strict-dynamic'` then lets those trusted scripts load their own chunks
 * without a host allowlist. There are no third-party scripts: Sentry goes
 * through the `/monitoring` tunnel, PostHog through the `/ingest` rewrite
 * (and is configured never to load scripts from its CDN).
 *
 * Trade-off (docs/content/decisions.md): a per-request nonce makes every
 * page dynamically rendered — no static/CDN-cached HTML. That is already
 * the case for the authenticated pages; for the public pages it is the
 * price of a strict CSP.
 *
 * `style-src` keeps `'unsafe-inline'`: React/Base UI/Tailwind emit inline
 * style attributes that a nonce cannot cover, and style injection is a far
 * weaker primitive than script injection.
 */

export function generateNonce(): string {
  return btoa(crypto.randomUUID());
}

/**
 * `MEDIA_ORIGINS`: the object-storage origins (S3 / R2 / MinIO) that
 * apps/server's presigned URLs point at, comma-separated. The browser PUTs
 * uploads straight to them and loads media variants from them, so they are
 * the only cross-origin hosts in `connect-src` / `img-src` / `media-src`.
 * Anything that is not a bare http(s) origin is ignored.
 */
export function parseOrigins(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  const origins = new Set<string>();
  for (const entry of value.split(",")) {
    try {
      const url = new URL(entry.trim());
      if (url.protocol === "https:" || url.protocol === "http:") {
        origins.add(url.origin);
      }
    } catch {
      // Not a URL — skip rather than widen the policy with garbage.
    }
  }
  return [...origins];
}

/**
 * Sentry's CSP report endpoint for a DSN
 * (`https://<key>@o1.ingest.sentry.io/<project>` →
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
  mediaOrigins = [],
  reportUri = null,
}: {
  nonce: string;
  isDev: boolean;
  /**
   * Only meaningful when the site is served over HTTPS. Over plain HTTP
   * (a production build under test on 127.0.0.1) WebKit really does rewrite
   * every subresource to https:// and the page breaks.
   */
  upgradeInsecureRequests?: boolean;
  /** Object-storage origins for presigned uploads/downloads (see `parseOrigins`). */
  mediaOrigins?: string[];
  /** Where browsers send violation reports (`sentryCspReportUri`). */
  reportUri?: string | null;
}): string {
  const media = mediaOrigins.map((origin) => ` ${origin}`).join("");
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    // blob: — local previews of picked/compressed images before upload.
    `img-src 'self' data: blob:${media}`,
    `media-src 'self' blob:${media}`,
    "font-src 'self' data:",
    // The browser only ever talks to this origin: apps/server is reached
    // through the same-origin `/api/rpc` proxy, Sentry through `/monitoring`,
    // PostHog through `/ingest`. The one exception is the presigned upload
    // PUT straight to object storage (bytes never pass through the API).
    `connect-src 'self'${media}${isDev ? " ws:" : ""}`,
    // The service worker (/serwist/sw.js) and image compression workers.
    "worker-src 'self' blob:",
    "manifest-src 'self'",
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
 * Trusted Types, in **report-only** mode: DOM XSS sinks (`innerHTML`,
 * `eval`-like APIs) assigned a plain string are reported, not blocked.
 * Enforcing it needs every dependency that writes HTML (Next's dev overlay,
 * Sentry Replay, Recharts) to use Trusted Types first; watch the reports,
 * then move this into the enforced policy. Chromium-only today; other
 * engines ignore it.
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
 * and redirects): nothing may load, nothing may frame them. Static, so no
 * nonce; still set by `proxy.ts` like every other CSP.
 */
export function buildApiContentSecurityPolicy(): string {
  return "default-src 'none'; frame-ancestors 'none'";
}

/** Policy for the service worker script (`/serwist/*`): our own code only. */
export function buildServiceWorkerContentSecurityPolicy(): string {
  return "default-src 'self'; script-src 'self'";
}
