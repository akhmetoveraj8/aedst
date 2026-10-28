import "server-only";

import * as oauth from "oauth4webapi";

import {
  clientForIdToken,
  discover,
  httpOptions,
  ID_TOKEN_ALG_ERROR,
  type OidcDeps,
  oidcClient,
  oidcClientAuth,
  verifyIdTokenSignature,
} from "@/shared/lib/auth/oidc/client";
import { getOidcConfig } from "@/shared/lib/auth/oidc/config";
import type { SessionTokens } from "@/shared/lib/auth/session-cookies";
import { sessionTokensFromResponse } from "@/shared/lib/auth/session-tokens";

export type RefreshResult =
  | { status: "ok"; tokens: SessionTokens }
  /** The session is over: clear the cookies. */
  | { status: "rejected" }
  /**
   * The IdP refused the token, but it was probably rotated by a concurrent
   * request on another replica whose Set-Cookie is on its way to the browser.
   * Treat the request as signed out but leave the cookies alone: clearing
   * them could overwrite the winner's fresh ones.
   */
  | { status: "stale" }
  | { status: "unavailable" };

/**
 * Refresh tokens rotate, so two concurrent requests presenting the same
 * (old) token would race: one wins, the other is rejected and would log the
 * user out. Within one process, concurrent calls share one in-flight promise
 * and a successful result stays reusable for a few seconds for requests that
 * were already on the wire with the old cookie.
 *
 * Across replicas there is no shared store (and ZITADEL documents no
 * refresh-token reuse grace), so the first rejection of a token is only
 * "stale" (see RefreshResult) and cached for RACE_WINDOW_MS; the same token
 * still being refused after the window is a genuinely dead session and is
 * "rejected". That tolerates the race but cannot make two replicas hand the
 * browser the same token: a lost winner response, or an IdP that revokes the
 * token family on reuse, still needs sticky routing (docs/content/decisions.md).
 */
const REUSE_WINDOW_MS = 10_000;
const RACE_WINDOW_MS = 15_000;
const MAX_TRACKED_REJECTIONS = 1_000;
const cache = new Map<string, Promise<RefreshResult>>();
/** Refresh token -> when the IdP first refused it (this process only). */
const firstRefused = new Map<string, number>();

export function refreshSession(
  refreshToken: string,
  deps?: OidcDeps,
): Promise<RefreshResult> {
  const existing = cache.get(refreshToken);
  if (existing) {
    return existing;
  }

  const attempt = performRefresh(refreshToken, deps);
  cache.set(refreshToken, attempt);
  void attempt.then((result) => {
    const ttl =
      result.status === "ok"
        ? REUSE_WINDOW_MS
        : result.status === "stale"
          ? RACE_WINDOW_MS
          : 0;
    setTimeout(() => cache.delete(refreshToken), ttl).unref?.();
  });
  return attempt;
}

/** First refusal of a token is "stale"; a repeat after the race window is final. */
function classifyRefusal(refreshToken: string): RefreshResult {
  const now = Date.now();
  const first = firstRefused.get(refreshToken);
  if (first !== undefined && now - first >= RACE_WINDOW_MS) {
    firstRefused.delete(refreshToken);
    return { status: "rejected" };
  }
  if (first === undefined) {
    if (firstRefused.size >= MAX_TRACKED_REJECTIONS) {
      // Oldest first (Map keeps insertion order); an evicted token simply
      // starts a new race window.
      const oldest = firstRefused.keys().next().value;
      if (oldest !== undefined) {
        firstRefused.delete(oldest);
      }
    }
    firstRefused.set(refreshToken, now);
  }
  return { status: "stale" };
}

/** OAuth errors that mean "this refresh token is finished" (RFC 6749 5.2). */
const DEFINITIVE_ERRORS = new Set([
  "invalid_grant",
  "invalid_token",
  "unauthorized_client",
]);

async function performRefresh(
  refreshToken: string,
  deps?: OidcDeps,
): Promise<RefreshResult> {
  try {
    const config = getOidcConfig();
    const server = await discover(config, deps);
    const response = await oauth.refreshTokenGrantRequest(
      server,
      oidcClient(config),
      oidcClientAuth(config),
      refreshToken,
      httpOptions(config, deps),
    );
    const result = await oauth.processRefreshTokenResponse(
      server,
      await clientForIdToken(config, response),
      response,
    );
    // A refresh response carries an ID token only sometimes; when it does,
    // it is verified like the one from the login. A forged one ends the
    // session (the IdP has already rotated the refresh token anyway).
    try {
      await verifyIdTokenSignature(config, server, response, result, deps);
    } catch (error) {
      if (error instanceof oauth.OperationProcessingError) {
        return { status: "rejected" };
      }
      throw error;
    }
    const tokens = sessionTokensFromResponse(result, refreshToken);
    return tokens ? { status: "ok", tokens } : { status: "rejected" };
  } catch (error) {
    const definitive =
      error instanceof oauth.ResponseBodyError &&
      DEFINITIVE_ERRORS.has(error.error);
    // Network failure, IdP 5xx, misconfiguration: the user stays signed in.
    if (
      error instanceof oauth.OperationProcessingError &&
      error.code === ID_TOKEN_ALG_ERROR
    ) {
      return { status: "rejected" };
    }
    if (!definitive) {
      return { status: "unavailable" };
    }
    // Only invalid_grant is what losing a rotation race looks like.
    return error instanceof oauth.ResponseBodyError &&
      error.error === "invalid_grant"
      ? classifyRefusal(refreshToken)
      : { status: "rejected" };
  }
}
