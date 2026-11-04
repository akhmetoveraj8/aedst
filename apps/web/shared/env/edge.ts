import * as z from "zod/mini";

// Env vars read by code that runs in `proxy.ts` and the session helpers it
// imports. Deliberately NOT guarded with `server-only` and built on
// `zod/mini` (not full `zod`): `shared/lib/auth/session-*.ts` is imported by
// `proxy.ts`, whose bundle must stay small, and `server-only` throws when a
// module is pulled in outside a React Server Components graph. None of
// these values is a secret (cookie name, claim names, origins, an internal
// service address); real secrets live only in `./server.ts`.
//
// Empty strings count as unset, like the other env modules.
const optionalNonEmpty = z.optional(z.string().check(z.minLength(1)));

const edgeEnvSchema = z.object({
  // Server-to-server address for apps/server (see ./server.ts for the long
  // form); proxy.ts and the Sentry trace-propagation target need it too.
  API_BASE_URL: z._default(z.url(), "http://localhost:8080"),
  // Session cookie base name; `__Host-` is prefixed on HTTPS sites.
  AUTH_COOKIE_NAME: z._default(
    z.string().check(z.minLength(1)),
    "aedst_session",
  ),
  // Where the roles live in the access token. Mirrors apps/server's
  // `AEDST_OIDC_ROLES_CLAIM`: `roles` for first-party tokens, a dotted path
  // such as `realm_access.roles` for Keycloak.
  AUTH_ROLES_CLAIM: z._default(z.string().check(z.minLength(1)), "roles"),
  // Mirrors apps/server's `AEDST_OIDC_ROLES_ORG`: for an object-shaped
  // claim (ZITADEL) keep only roles granted in this organisation. Empty =
  // any organisation.
  AUTH_ROLES_ORG: z._default(z.string(), ""),
  // Comma-separated extra origins allowed to serve media (CSP img/media-src).
  MEDIA_ORIGINS: optionalNonEmpty,
});

export const edgeEnv = edgeEnvSchema.parse({
  API_BASE_URL: process.env.API_BASE_URL || undefined,
  AUTH_COOKIE_NAME: process.env.AUTH_COOKIE_NAME || undefined,
  AUTH_ROLES_CLAIM: process.env.AUTH_ROLES_CLAIM || undefined,
  AUTH_ROLES_ORG: process.env.AUTH_ROLES_ORG || undefined,
  MEDIA_ORIGINS: process.env.MEDIA_ORIGINS || undefined,
});
