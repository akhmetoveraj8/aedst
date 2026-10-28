import * as Sentry from "@sentry/nextjs";

/**
 * The only other doors to Sentry besides `reportError` / `ErrorBoundary`
 * (Biome `noRestrictedImports` keeps `@sentry/nextjs` inside
 * `src/app/config`, `src/instrumentation*.ts` and this folder).
 */

type Breadcrumb = { category: string; message: string; level?: "info" };

/** Records what the user did, so a Sentry event shows the lead-up. */
export function addBreadcrumb(breadcrumb: Breadcrumb): void {
  Sentry.addBreadcrumb(breadcrumb);
}

/** Attaches the signed-in user (id only, never PII) to later events. */
export function setErrorUser(userId: string | null): void {
  Sentry.setUser(userId ? { id: userId } : null);
}
