import "server-only";

import { randomBytes } from "node:crypto";

import {
  clientEnv,
  isProduction as isProductionBuild,
} from "@/shared/env/client";
import { serverEnv } from "@/shared/env/server";

/** Thrown when sign-in is used but the OIDC settings are missing or unsafe. */
export class OidcConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OidcConfigError";
  }
}

export type OidcConfig = {
  issuer: URL;
  clientId: string;
  /** Present only for a confidential client; a public PKCE client has none. */
  clientSecret?: string;
  scope: string;
  redirectUri: string;
  postLogoutRedirectUri: string;
  /** Plain http is accepted for loopback issuers only (local development). */
  allowInsecureHttp: boolean;
  stateSecret: string;
};

export type OidcEnv = Pick<
  typeof serverEnv,
  | "OIDC_ISSUER"
  | "OIDC_CLIENT_ID"
  | "OIDC_CLIENT_SECRET"
  | "OIDC_PROJECT_ID"
  | "OIDC_SCOPE"
  | "OIDC_STATE_SECRET"
>;

/** Path of the Route Handler that finishes the flow; register this exact URL at the IdP. */
const CALLBACK_PATH = "/api/auth/callback";

const DEFAULT_SCOPE = "openid profile email offline_access";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

// Only used when OIDC_STATE_SECRET is unset outside production: the pre-auth
// cookie lives minutes, so a per-process key is enough for one dev server.
let developmentSecret: string | undefined;

/** The ZITADEL scope that puts the project id into the access token `aud`. */
function projectAudienceScope(projectId: string): string {
  return `urn:zitadel:iam:org:project:id:${projectId}:aud`;
}

export function getOidcConfig(
  env: OidcEnv = serverEnv,
  siteUrl: string = clientEnv.NEXT_PUBLIC_SITE_URL,
  isProduction: boolean = isProductionBuild,
): OidcConfig {
  if (!env.OIDC_ISSUER || !env.OIDC_CLIENT_ID) {
    throw new OidcConfigError(
      "OIDC_ISSUER and OIDC_CLIENT_ID must be set to sign in (see .env.example)",
    );
  }
  const issuer = new URL(env.OIDC_ISSUER);
  const allowInsecureHttp = LOOPBACK_HOSTS.has(issuer.hostname);
  if (issuer.protocol !== "https:" && !allowInsecureHttp) {
    throw new OidcConfigError("OIDC_ISSUER must be https outside localhost");
  }

  let stateSecret = env.OIDC_STATE_SECRET;
  if (!stateSecret) {
    if (isProduction) {
      throw new OidcConfigError(
        "OIDC_STATE_SECRET (32+ chars, shared by all replicas) is required in production",
      );
    }
    developmentSecret ??= randomBytes(32).toString("base64url");
    stateSecret = developmentSecret;
  }

  const scope =
    env.OIDC_SCOPE ??
    [
      DEFAULT_SCOPE,
      ...(env.OIDC_PROJECT_ID
        ? [projectAudienceScope(env.OIDC_PROJECT_ID)]
        : []),
    ].join(" ");
  const origin = new URL(siteUrl).origin;

  return {
    issuer,
    clientId: env.OIDC_CLIENT_ID,
    clientSecret: env.OIDC_CLIENT_SECRET,
    scope,
    redirectUri: `${origin}${CALLBACK_PATH}`,
    postLogoutRedirectUri: origin,
    allowInsecureHttp,
    stateSecret,
  };
}
