import "server-only";
import { z } from "zod";

import { edgeEnv } from "@/shared/env/edge";

// `import "server-only"` makes the build fail immediately if a Client
// Component ever imports this file — the only thing standing between a
// future mistake and a leaked secret in the browser bundle. Never weaken
// this file to also export client vars "for convenience"; import
// `clientEnv` from `./client` separately wherever both are needed
// server-side (that direction is always safe).
const serverEnvSchema = z.object({
  // Server-to-server address for apps/server. The browser never uses it: it
  // calls this app's same-origin `/api/rpc` BFF route, and only server code
  // (Server Components, Server Actions, Route Handlers, proxy.ts) reaches the
  // API at this address — in production an internal service address.
  // (The session cookie name, AUTH_COOKIE_NAME, and the roles claim,
  // AUTH_ROLES_CLAIM, are read directly by shared/lib/auth because proxy.ts
  // needs them too.)
  // Parsed once in ./edge.ts (proxy.ts needs it too) and re-validated here.
  API_BASE_URL: z.url(),

  // OpenID Connect (the identity provider; ZITADEL by default). All optional
  // at parse time so `next build` and the unauthenticated parts of the app
  // work without an IdP; `getOidcConfig()` (shared/lib/auth/oidc/config.ts)
  // fails with a clear message the first time a login actually needs them.
  // Must match apps/server's AEDST_OIDC_ISSUER.
  OIDC_ISSUER: z.url().optional(),
  // The PKCE application's client id (printed by deployments/zitadel/bootstrap.sh).
  OIDC_CLIENT_ID: z.string().min(1).optional(),
  // Only for a confidential client. A public PKCE client (the default) has none.
  OIDC_CLIENT_SECRET: z.string().min(1).optional(),
  // ZITADEL project id = the access token audience (AEDST_OIDC_AUDIENCE).
  // Adds the scope `urn:zitadel:iam:org:project:id:<id>:aud`.
  OIDC_PROJECT_ID: z.string().min(1).optional(),
  // Full scope override (space separated) for providers that need other
  // scopes, e.g. Keycloak. Replaces the default and the project-id scope.
  OIDC_SCOPE: z.string().min(1).optional(),
  // Seals the short-lived pre-auth cookie (AES-256-GCM). At least 32 chars;
  // required in production (it must be shared by all replicas). Without it
  // development uses a random per-process key.
  OIDC_STATE_SECRET: z.string().min(32).optional(),

  // Sentry source-map upload during `next build` (see next.config.ts's
  // withSentryConfig call) reads this directly via `process.env`, not
  // through this schema — next.config.ts runs before the app boots, so it
  // can't import an app module. It's validated here too so any *runtime*
  // code that needs it (there is none today) gets the same
  // fail-fast-on-missing-value guarantee as every other server var.
  SENTRY_AUTH_TOKEN: z.string().optional(),

  // Build revision (CI commit) used to version precached offline pages.
  GITHUB_SHA: z.string().min(1).optional(),
  VERCEL_GIT_COMMIT_SHA: z.string().min(1).optional(),
});

export const serverEnv = serverEnvSchema.parse({
  API_BASE_URL: edgeEnv.API_BASE_URL,
  OIDC_ISSUER: process.env.OIDC_ISSUER || undefined,
  OIDC_CLIENT_ID: process.env.OIDC_CLIENT_ID || undefined,
  OIDC_CLIENT_SECRET: process.env.OIDC_CLIENT_SECRET || undefined,
  OIDC_PROJECT_ID: process.env.OIDC_PROJECT_ID || undefined,
  OIDC_SCOPE: process.env.OIDC_SCOPE || undefined,
  OIDC_STATE_SECRET: process.env.OIDC_STATE_SECRET || undefined,
  SENTRY_AUTH_TOKEN: process.env.SENTRY_AUTH_TOKEN || undefined,
  GITHUB_SHA: process.env.GITHUB_SHA || undefined,
  VERCEL_GIT_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA || undefined,
});
