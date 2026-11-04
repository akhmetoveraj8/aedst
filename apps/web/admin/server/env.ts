import { z } from "zod";

/**
 * The BFF's whole configuration, validated once at boot. This is the only file
 * in server/ that reads `process.env`; everything else receives `ServerEnv`.
 *
 * The shared auth kit (`shared/lib/auth`) still reads a few variables straight
 * from `process.env` at import time (API_BASE_URL, AUTH_COOKIE_NAME,
 * AUTH_ROLES_*, OIDC_*, and NEXT_PUBLIC_SITE_URL for the `__Host-` cookie
 * prefix). `bootstrap.ts` runs this schema first and mirrors ADMIN_ORIGIN into
 * NEXT_PUBLIC_SITE_URL, so there is exactly one source of truth.
 *
 * Empty strings count as unset, like the other env modules of the workspace.
 */
const blankToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess(blankToUndefined, schema.optional());

const withDefault = <T extends z.ZodType>(schema: T, fallback: z.output<T>) =>
  z.preprocess(blankToUndefined, schema.default(fallback as never));

const port = z.coerce.number().int().min(1).max(65_535);

const schema = z
  .object({
    NODE_ENV: withDefault(
      z.enum(["development", "production", "test"]),
      "development",
    ),
    // `ADMIN_BFF_PORT` wins over `PORT` (the container sets PORT=3001; the
    // dev server proxies to 3101 by default).
    ADMIN_BFF_PORT: optional(port),
    PORT: optional(port),
    // Browser-visible origin of the admin panel (scheme + host [+ port], no
    // path). Redirect URIs, cookie prefix and the same-origin check use it.
    // Defaults to http://localhost:3001 outside production only.
    ADMIN_ORIGIN: optional(z.url()),
    // Directory with the Vite build (index.html + assets). Defaults to
    // `<project>/dist` next to dist-server/ and server/.
    ADMIN_STATIC_DIR: optional(z.string().min(1)),
    // Server-to-server address of apps/server (never reaches the browser).
    API_BASE_URL: withDefault(z.url(), "http://localhost:8080"),
    // Not "aedst_session": on localhost cookies ignore ports, so the product
    // app and the admin panel would overwrite each other's session in dev.
    AUTH_COOKIE_NAME: withDefault(z.string().min(1), "aedst_admin_session"),
    OIDC_ISSUER: optional(z.url()),
    OIDC_CLIENT_ID: optional(z.string().min(1)),
    OIDC_CLIENT_SECRET: optional(z.string().min(1)),
    OIDC_PROJECT_ID: optional(z.string().min(1)),
    OIDC_SCOPE: optional(z.string().min(1)),
    OIDC_STATE_SECRET: optional(z.string().min(32)),
    // Sentry DSN of the browser project: used to derive the CSP report URI and
    // as the ingest origin allowed in connect-src. Not a secret.
    SENTRY_DSN: optional(z.url()),
    // Honour X-Forwarded-For for the client address in logs. Enable only
    // behind a proxy that overwrites the header.
    TRUST_PROXY: withDefault(z.stringbool(), false),
    LOG_LEVEL: withDefault(
      z.enum(["debug", "info", "warn", "error", "silent"]),
      "info",
    ),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== "production") {
      return;
    }
    // Fail fast instead of discovering a missing origin or IdP setting later.
    for (const key of [
      "ADMIN_ORIGIN",
      "OIDC_ISSUER",
      "OIDC_CLIENT_ID",
      "OIDC_STATE_SECRET",
    ] as const) {
      if (!env[key]) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: `${key} is required in production`,
        });
      }
    }
    // Over plain http the cookies lose `Secure` and the `__Host-` prefix and
    // the CSP stops upgrading requests: only a loopback host may run that way
    // (a local smoke test), never a real deployment.
    if (env.ADMIN_ORIGIN) {
      const { protocol, hostname } = new URL(env.ADMIN_ORIGIN);
      const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
      if (protocol !== "https:" && !loopback) {
        ctx.addIssue({
          code: "custom",
          path: ["ADMIN_ORIGIN"],
          message: "ADMIN_ORIGIN must be https in production",
        });
      }
    }
  });

export type ServerEnv = Omit<
  z.infer<typeof schema>,
  "ADMIN_ORIGIN" | "ADMIN_BFF_PORT" | "PORT"
> & {
  /** Normalized to an origin: no path, no trailing slash. */
  ADMIN_ORIGIN: string;
  /** Resolved listening port. */
  listenPort: number;
  /** `https:` origin: cookies get `Secure` and the `__Host-` prefix. */
  secureSite: boolean;
  isProduction: boolean;
};

export function parseEnv(
  source: Record<string, string | undefined>,
): ServerEnv {
  const parsed = schema.parse(source);
  const origin = new URL(parsed.ADMIN_ORIGIN ?? "http://localhost:3001").origin;
  return {
    ...parsed,
    ADMIN_ORIGIN: origin,
    listenPort: parsed.ADMIN_BFF_PORT ?? parsed.PORT ?? 3101,
    secureSite: origin.startsWith("https:"),
    isProduction: parsed.NODE_ENV === "production",
  };
}
