import * as z from "zod/mini";

// Admin-only public env, read by the browser bundle. Everything shared with the
// other web projects (Sentry, site URL) stays in `@/shared/env/client`, which
// vite.config.ts feeds from the matching `VITE_*` variables. `import.meta.env`
// is inlined at build time: never put a secret here.
const adminEnvSchema = z.object({
  // Origin of the product app project (apps/web/app): target of the "back to
  // app" link only. Admin signs in on its own origin with its own OIDC client.
  // An origin only, no path.
  VITE_APP_URL: z._default(z.url(), "http://localhost:3000"),
  // Sentry release the SDK reports (the Vite plugin injects the uploaded one).
  VITE_SENTRY_RELEASE: z.optional(z.string()),
});

export const adminEnv = adminEnvSchema.parse({
  VITE_APP_URL: import.meta.env.VITE_APP_URL || undefined,
  VITE_SENTRY_RELEASE: import.meta.env.VITE_SENTRY_RELEASE || undefined,
});

/**
 * The BFF's sign-in entry (a full-page navigation, never fetch). `next` is the
 * post-login destination; the BFF validates it again.
 */
export function signInUrl(next: string): string {
  return `/api/auth/login?next=${encodeURIComponent(next)}`;
}
