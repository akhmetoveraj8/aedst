import "server-only";

import * as oauth from "oauth4webapi";

import type { OidcConfig } from "@/shared/lib/auth/oidc/config";

/** Injection point for tests; production uses the global `fetch`. */
export type OidcDeps = { fetch?: typeof fetch };

const HTTP_TIMEOUT_MS = 8_000;
const DISCOVERY_TTL_MS = 60 * 60 * 1000;

const discoveryCache = new Map<
  string,
  { server: oauth.AuthorizationServer; expiresAt: number }
>();

/** Test hook: forget cached discovery documents. */
export function clearDiscoveryCache(): void {
  discoveryCache.clear();
}

export function oidcClient(config: OidcConfig): oauth.Client {
  return { client_id: config.clientId };
}

export function oidcClientAuth(config: OidcConfig): oauth.ClientAuth {
  return config.clientSecret
    ? oauth.ClientSecretPost(config.clientSecret)
    : oauth.None();
}

/** Options every oauth4webapi HTTP call gets: timeout, loopback http, injected fetch. */
export function httpOptions(config: OidcConfig, deps: OidcDeps = {}) {
  const customFetch = deps.fetch;
  return {
    signal: () => AbortSignal.timeout(HTTP_TIMEOUT_MS),
    [oauth.allowInsecureRequests]: config.allowInsecureHttp,
    ...(customFetch
      ? {
          [oauth.customFetch]: (url: string, init: RequestInit) =>
            customFetch(url, init),
        }
      : {}),
  };
}

/** OIDC discovery (cached for an hour; a failure is never cached). */
export async function discover(
  config: OidcConfig,
  deps: OidcDeps = {},
  nowMs: number = Date.now(),
): Promise<oauth.AuthorizationServer> {
  const key = config.issuer.href;
  const cached = discoveryCache.get(key);
  if (cached && cached.expiresAt > nowMs) {
    return cached.server;
  }
  const response = await oauth.discoveryRequest(config.issuer, {
    algorithm: "oidc",
    ...httpOptions(config, deps),
  });
  const server = await oauth.processDiscoveryResponse(config.issuer, response);
  discoveryCache.set(key, { server, expiresAt: nowMs + DISCOVERY_TTL_MS });
  return server;
}

/**
 * ID token signature algorithms accepted, asymmetric only. `none` and the HMAC
 * family never verify against a public JWKS and are refused before the library
 * sees them. ZITADEL signs RS256; ES256 and EdDSA cover other IdPs.
 */
const ID_TOKEN_ALGORITHMS: ReadonlySet<string> = new Set([
  "RS256",
  "ES256",
  "EdDSA",
]);

/** `code` of the error thrown for an ID token signed with a disallowed algorithm. */
export const ID_TOKEN_ALG_ERROR = "AEDST_ID_TOKEN_ALG";

function idTokenAlgorithm(idToken: string): string | undefined {
  try {
    const header: unknown = JSON.parse(
      Buffer.from(idToken.split(".")[0] ?? "", "base64url").toString(),
    );
    const alg = (header as { alg?: unknown } | null)?.alg;
    return typeof alg === "string" ? alg : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The client to validate a token response's ID token with: it pins the ID
 * token's expected `alg` to the one in its header, after checking that header
 * against the allow-list (oauth4webapi otherwise assumes RS256). The key is
 * still chosen by `alg` + `kid` from the issuer's JWKS, so a forged header
 * cannot select a symmetric or attacker-supplied key.
 */
export async function clientForIdToken(
  config: OidcConfig,
  response: Response,
): Promise<oauth.Client> {
  const client = oidcClient(config);
  let idToken: unknown;
  try {
    idToken = ((await response.clone().json()) as { id_token?: unknown })
      ?.id_token;
  } catch {
    return client; // the library reports a malformed body itself
  }
  if (typeof idToken !== "string") {
    return client;
  }
  const alg = idTokenAlgorithm(idToken);
  if (!alg || !ID_TOKEN_ALGORITHMS.has(alg)) {
    throw new oauth.OperationProcessingError(
      "ID token signed with a disallowed algorithm",
      { code: ID_TOKEN_ALG_ERROR },
    );
  }
  return { ...client, id_token_signed_response_alg: alg };
}

/**
 * Verifies the signature of the ID token in an already processed token
 * response against the issuer's JWKS (`jwks_uri` from discovery). oauth4webapi
 * keeps that JWKS in memory per discovery document: it is dropped after 5
 * minutes, and an unknown `kid` triggers one re-download (at most one per
 * minute) before failing. A no-op when the response carried no ID token (a
 * refresh response may omit it). Rejects with `OperationProcessingError` for a
 * bad signature or unknown key; network failures propagate as-is.
 */
export async function verifyIdTokenSignature(
  config: OidcConfig,
  server: oauth.AuthorizationServer,
  response: Response,
  tokens: Pick<oauth.TokenEndpointResponse, "id_token">,
  deps?: OidcDeps,
): Promise<void> {
  if (!tokens.id_token) {
    return;
  }
  await oauth.validateApplicationLevelSignature(
    server,
    response,
    httpOptions(config, deps),
  );
}
