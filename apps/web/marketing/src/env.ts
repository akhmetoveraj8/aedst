import * as z from "zod/mini";

// Marketing-only public environment. `shared/env/client.ts` is app-specific
// (Sentry, PostHog, consent) and has no APP_URL, so this project owns its own
// schema. Every var is NEXT_PUBLIC_*: inlined into the bundle at build time,
// so nothing here may ever be a secret.
const clientEnvSchema = z.object({
  // Canonical origin of this site.
  NEXT_PUBLIC_SITE_URL: z._default(z.url(), "http://localhost:3002"),
  // Origin of the product app that the CTA buttons link to.
  NEXT_PUBLIC_APP_URL: z._default(z.url(), "http://localhost:3000"),
  NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION: z.optional(
    z.string().check(z.minLength(1)),
  ),
  NEXT_PUBLIC_BING_SITE_VERIFICATION: z.optional(
    z.string().check(z.minLength(1)),
  ),
});

export const clientEnv = clientEnvSchema.parse({
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL || undefined,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL || undefined,
  NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION:
    process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION || undefined,
  NEXT_PUBLIC_BING_SITE_VERIFICATION:
    process.env.NEXT_PUBLIC_BING_SITE_VERIFICATION || undefined,
});
