/**
 * Why a sign-in attempt ended without a session. Carried to the login page as
 * `?auth_error=<code>` by the OIDC callback; a closed set, so nothing the IdP
 * or an attacker puts in the callback URL can reach the page as text.
 */
const AUTH_ERROR_CODES = [
  /** The user cancelled or the IdP refused access. */
  "denied",
  /** The login took too long or the browser lost its pre-auth cookie. */
  "expired",
  /** State, nonce, code or token validation failed. */
  "invalid",
  /** The IdP issued an opaque access token; apps/server needs a JWT. */
  "opaque_token",
  /** The IdP could not be reached. */
  "unavailable",
  /** OIDC_* settings are missing or unsafe. */
  "config",
] as const;

export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[number];

export function parseAuthError(
  value: string | null | undefined,
): AuthErrorCode | undefined {
  return AUTH_ERROR_CODES.find((code) => code === value);
}
