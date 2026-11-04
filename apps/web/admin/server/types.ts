import type { OidcConfig } from "@/shared/lib/auth/oidc/config";
import type {
  buildEndSessionUrl,
  completeLogin,
  revokeRefreshToken,
  startLogin,
} from "@/shared/lib/auth/oidc/login-flow";
import type { refreshSession } from "@/shared/lib/auth/refresh-session";
import type { ServerEnv } from "./env";
import type { Logger } from "./logger";

/** The OIDC pieces of `shared/lib/auth`, injectable so tests need no IdP. */
export type AuthDeps = {
  getOidcConfig: () => OidcConfig;
  startLogin: typeof startLogin;
  completeLogin: typeof completeLogin;
  refreshSession: typeof refreshSession;
  revokeRefreshToken: typeof revokeRefreshToken;
  buildEndSessionUrl: typeof buildEndSessionUrl;
};

/** Everything `createApp` needs from the outside world. */
export type AppDeps = {
  env: ServerEnv;
  /** Used for apps/server, and the IdP. */
  fetch: typeof fetch;
  logger: Logger;
  auth: AuthDeps;
  /** The Vite build's index.html (contains `__CSP_NONCE__`); read lazily. */
  readIndexHtml: () => Promise<string>;
  /** Directory of the Vite build (static files). */
  staticDir: string;
};

export type AppBindings = {
  Variables: { requestId: string };
};
