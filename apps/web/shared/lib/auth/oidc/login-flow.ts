import "server-only";

import * as oauth from "oauth4webapi";

import type { AuthErrorCode } from "@/shared/lib/auth/auth-errors";
import {
  clientForIdToken,
  discover,
  httpOptions,
  type OidcDeps,
  oidcClient,
  oidcClientAuth,
  verifyIdTokenSignature,
} from "@/shared/lib/auth/oidc/client";
import type { OidcConfig } from "@/shared/lib/auth/oidc/config";
import {
  openPreAuth,
  type PreAuthState,
  sealPreAuth,
} from "@/shared/lib/auth/oidc/pre-auth-cookie";
import { safeRedirectPath } from "@/shared/lib/auth/safe-redirect";
import type { SessionTokens } from "@/shared/lib/auth/session-cookies";
import { sessionTokensFromResponse } from "@/shared/lib/auth/session-tokens";

/**
 * OpenID Connect Authorization Code + PKCE, as the backend-for-frontend half
 * of the browser login. Pure of Next.js APIs (cookies and redirects belong to
 * the Route Handlers) so every branch is unit-testable with an injected fetch.
 */

export type StartedLogin = {
  /** The IdP authorization URL to send the browser to. */
  location: string;
  /** Value for the pre-auth cookie. */
  sealed: string;
};

export async function startLogin({
  config,
  next,
  register = false,
  deps,
  nowMs,
}: {
  config: OidcConfig;
  /** Untrusted post-login destination; validated here. */
  next?: string | null;
  /** Open the IdP on its registration form (`prompt=create`, ZITADEL). */
  register?: boolean;
  deps?: OidcDeps;
  nowMs?: number;
}): Promise<StartedLogin> {
  const server = await discover(config, deps);
  if (!server.authorization_endpoint) {
    throw new Error("the IdP advertises no authorization_endpoint");
  }
  if (
    server.code_challenge_methods_supported &&
    !server.code_challenge_methods_supported.includes("S256")
  ) {
    throw new Error("the IdP does not support PKCE S256");
  }

  const pre: PreAuthState = {
    state: oauth.generateRandomState(),
    nonce: oauth.generateRandomNonce(),
    codeVerifier: oauth.generateRandomCodeVerifier(),
    next: safeRedirectPath(next),
  };

  const url = new URL(server.authorization_endpoint);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", config.scope);
  url.searchParams.set("state", pre.state);
  url.searchParams.set("nonce", pre.nonce);
  url.searchParams.set(
    "code_challenge",
    await oauth.calculatePKCECodeChallenge(pre.codeVerifier),
  );
  url.searchParams.set("code_challenge_method", "S256");
  if (register) {
    url.searchParams.set("prompt", "create");
  }

  return {
    location: url.href,
    sealed: sealPreAuth(pre, config.stateSecret, nowMs),
  };
}

export type CompletedLogin =
  | { ok: true; tokens: SessionTokens; next: string }
  | { ok: false; reason: AuthErrorCode; next?: string };

export async function completeLogin({
  config,
  callbackUrl,
  sealed,
  deps,
  nowMs,
}: {
  config: OidcConfig;
  callbackUrl: URL;
  /** The pre-auth cookie value, if the browser sent one. */
  sealed: string | undefined;
  deps?: OidcDeps;
  nowMs?: number;
}): Promise<CompletedLogin> {
  const pre = openPreAuth(sealed, config.stateSecret, nowMs);
  if (!pre) {
    return { ok: false, reason: "expired" };
  }
  const fail = (reason: AuthErrorCode): CompletedLogin => ({
    ok: false,
    reason,
    next: pre.next,
  });

  try {
    const server = await discover(config, deps);
    const client = oidcClient(config);

    // Checks `state` (against the sealed one), `iss`, and turns an `error=`
    // answer into an AuthorizationResponseError.
    const params = oauth.validateAuthResponse(
      server,
      client,
      callbackUrl,
      pre.state,
    );
    if (!params.get("code")) {
      return fail("invalid");
    }

    const response = await oauth.authorizationCodeGrantRequest(
      server,
      client,
      oidcClientAuth(config),
      params,
      config.redirectUri,
      pre.codeVerifier,
      httpOptions(config, deps),
    );
    // Validates the token response and the ID token claims (iss, aud, exp,
    // nonce), then the ID token signature against the issuer's JWKS. TLS to
    // the token endpoint would suffice per OIDC Core 3.1.3.7; the signature
    // is checked anyway (defence in depth, and the ID token is later stored
    // in a cookie and replayed as id_token_hint).
    const result = await oauth.processAuthorizationCodeResponse(
      server,
      await clientForIdToken(config, response),
      response,
      { expectedNonce: pre.nonce, requireIdToken: true },
    );
    await verifyIdTokenSignature(config, server, response, result, deps);

    // apps/server verifies JWTs offline; an opaque token would 401 every call.
    if (result.access_token.split(".").length !== 3) {
      return fail("opaque_token");
    }
    const tokens = sessionTokensFromResponse(result);
    return tokens ? { ok: true, tokens, next: pre.next } : fail("invalid");
  } catch (error) {
    return fail(classifyLoginError(error));
  }
}

function classifyLoginError(error: unknown): AuthErrorCode {
  if (error instanceof oauth.AuthorizationResponseError) {
    return error.error === "access_denied" ? "denied" : "invalid";
  }
  if (
    error instanceof oauth.OperationProcessingError ||
    error instanceof oauth.ResponseBodyError
  ) {
    return "invalid";
  }
  return "unavailable";
}

/**
 * RP-initiated logout (OIDC RP-Initiated Logout 1.0): the IdP's
 * `end_session_endpoint` with `id_token_hint` and `post_logout_redirect_uri`,
 * or `null` when the IdP does not advertise one (or is unreachable) and the
 * local sign-out is all there is.
 */
export async function buildEndSessionUrl({
  config,
  idToken,
  deps,
}: {
  config: OidcConfig;
  idToken: string | undefined;
  deps?: OidcDeps;
}): Promise<string | null> {
  try {
    const server = await discover(config, deps);
    if (!server.end_session_endpoint) {
      return null;
    }
    const url = new URL(server.end_session_endpoint);
    url.searchParams.set("client_id", config.clientId);
    url.searchParams.set(
      "post_logout_redirect_uri",
      config.postLogoutRedirectUri,
    );
    if (idToken) {
      url.searchParams.set("id_token_hint", idToken);
    }
    return url.href;
  } catch {
    return null;
  }
}

/** Best-effort RFC 7009 revocation; never throws (the cookies are cleared regardless). */
export async function revokeRefreshToken({
  config,
  refreshToken,
  deps,
}: {
  config: OidcConfig;
  refreshToken: string;
  deps?: OidcDeps;
}): Promise<void> {
  try {
    const server = await discover(config, deps);
    if (!server.revocation_endpoint) {
      return;
    }
    const response = await oauth.revocationRequest(
      server,
      oidcClient(config),
      oidcClientAuth(config),
      refreshToken,
      {
        ...httpOptions(config, deps),
        additionalParameters: { token_type_hint: "refresh_token" },
      },
    );
    await oauth.processRevocationResponse(response);
  } catch {
    // The session ends locally either way.
  }
}
