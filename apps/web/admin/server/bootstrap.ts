import { parseEnv } from "./env";

/**
 * Must be the FIRST import of main.ts and of the test setup. The shared auth
 * kit (`@/shared/lib/auth/*`, `@/shared/env/*`) parses `process.env` when it is
 * first imported, and it knows the site origin only as NEXT_PUBLIC_SITE_URL
 * (it decides the `__Host-` cookie prefix). Validate once here and mirror
 * ADMIN_ORIGIN into that name before any shared module loads.
 */
export const env = parseEnv(process.env);

process.env.NEXT_PUBLIC_SITE_URL = env.ADMIN_ORIGIN;
process.env.API_BASE_URL = env.API_BASE_URL;
process.env.AUTH_COOKIE_NAME = env.AUTH_COOKIE_NAME;
