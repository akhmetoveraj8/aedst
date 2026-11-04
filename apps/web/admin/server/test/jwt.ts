/** Unsigned JWT-shaped strings: enough for code that only reads claims. */

const encode = (value: object) =>
  btoa(JSON.stringify(value))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

export function fakeJwt({
  sub = "user-1",
  expiresInSeconds,
  claims = {},
}: {
  sub?: string;
  expiresInSeconds: number;
  claims?: Record<string, unknown>;
}): string {
  const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
  return `${encode({ alg: "none" })}.${encode({ sub, exp, ...claims })}.signature`;
}

/** An access token with a plain `roles` array (the AUTH_ROLES_CLAIM default). */
export function tokenWithRoles(roles: string[], expiresInSeconds = 600) {
  return fakeJwt({ expiresInSeconds, claims: { roles } });
}

/** An ID token for the session endpoint's display fields. */
export function idToken(claims: Record<string, unknown>) {
  return fakeJwt({ expiresInSeconds: 600, claims });
}
