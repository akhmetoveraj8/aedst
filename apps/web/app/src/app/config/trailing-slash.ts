/**
 * Canonical URLs have no trailing slash (`/en`, not `/en/`). `next.config.ts`
 * sets `skipTrailingSlashRedirect` (PostHog's `/ingest/e/` paths must keep
 * theirs), so Next no longer normalises page URLs and `proxy.ts` does it.
 * Pure and Edge-safe: no imports.
 */

const KEEP_TRAILING_SLASH = ["/ingest", "/api", "/monitoring", "/serwist"];

/** The path without its trailing slash, or `null` when it needs no redirect. */
export function withoutTrailingSlash(pathname: string): string | null {
  if (pathname.length <= 1 || !pathname.endsWith("/")) {
    return null;
  }
  const exempt = KEEP_TRAILING_SLASH.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  if (exempt) {
    return null;
  }
  return pathname.replace(/\/+$/, "") || null;
}
