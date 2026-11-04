import * as z from "zod/mini";

// Admin-only public env. Everything shared with the other web projects
// (API_BASE_URL, cookie name, roles claim, Sentry, NEXT_PUBLIC_SITE_URL)
// stays in `@/shared/env/*`. `zod/mini` keeps the `proxy.ts` bundle small.
//
// NEXT_PUBLIC_* values are inlined at build time: never put a secret here.
const adminEnvSchema = z.object({
  // Origin of the product app project (apps/web/app): target of the "back to
  // app" link only. Admin signs in on its own origin with its own OIDC client.
  // An origin only, no path.
  NEXT_PUBLIC_APP_URL: z._default(z.url(), "http://localhost:3000"),
});

export const adminEnv = adminEnvSchema.parse({
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL || undefined,
});

/**
 * This project's own sign-in entry (the OIDC login Route Handler). `next` is
 * the post-login destination; the Route Handler validates it again.
 */
export function signInUrl(next: string): string {
  return `/api/auth/login?next=${encodeURIComponent(next)}`;
}
