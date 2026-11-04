/**
 * Browser side of admin sign-out: `POST /api/auth/logout` on the BFF, which
 * clears the httpOnly session cookies, revokes the refresh token at the IdP and
 * answers `{ endSessionUrl }` (the IdP's RP-initiated logout URL, or `null`).
 * The custom header makes it a non-simple request, so a cross-site form cannot
 * forge it (the BFF also checks `Sec-Fetch-Site`).
 */
export type LogoutResult = {
  /** The IdP's end-session URL to navigate to, or `null` if none. */
  endSessionUrl: string | null;
};

export async function requestLogout(): Promise<LogoutResult> {
  const response = await fetch("/api/auth/logout", {
    method: "POST",
    credentials: "same-origin",
    headers: { "x-requested-with": "fetch", accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Logout failed with HTTP ${response.status}`);
  }
  const body = (await response.json()) as Partial<LogoutResult>;
  return { endSessionUrl: body.endSessionUrl ?? null };
}
