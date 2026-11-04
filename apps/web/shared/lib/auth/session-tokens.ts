import type { TokenEndpointResponse } from "oauth4webapi";

import {
  REFRESH_COOKIE_MAX_AGE_SECONDS,
  type SessionTokens,
} from "@/shared/lib/auth/session-cookies";

const FALLBACK_ACCESS_MAX_AGE_SECONDS = 60 * 15;

/**
 * Maps an OIDC token endpoint response to what the cookie layer stores.
 * Returns `null` when a token is missing: a "successful" response without
 * tokens must fail loudly instead of becoming a signed-in session holding
 * blank credentials. A refresh response may omit `refresh_token` (RFC 6749
 * section 6: the old one stays valid), which `fallbackRefreshToken` covers.
 */
export function sessionTokensFromResponse(
  response: Pick<
    TokenEndpointResponse,
    "access_token" | "refresh_token" | "expires_in" | "id_token"
  >,
  fallbackRefreshToken?: string,
): SessionTokens | null {
  const refreshToken = response.refresh_token || fallbackRefreshToken;
  if (!response.access_token || !refreshToken) {
    return null;
  }
  const expiresIn = response.expires_in;
  return {
    accessToken: response.access_token,
    refreshToken,
    accessMaxAgeSeconds:
      typeof expiresIn === "number" &&
      Number.isFinite(expiresIn) &&
      expiresIn > 0
        ? Math.floor(expiresIn)
        : FALLBACK_ACCESS_MAX_AGE_SECONDS,
    refreshMaxAgeSeconds: REFRESH_COOKIE_MAX_AGE_SECONDS,
    idToken: response.id_token || undefined,
  };
}
