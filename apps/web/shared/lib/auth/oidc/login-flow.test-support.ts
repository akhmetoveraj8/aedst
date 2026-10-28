// Shared harness for the login-flow tests (split by concern to keep each
// file small): a fake IdP wired to the PKCE round trip.
import { createHash } from "node:crypto";

import { completeLogin, startLogin } from "@/shared/lib/auth/oidc/login-flow";
import {
  createFakeIdp,
  idToken,
  testOidcConfig,
  unsignedJwt,
} from "@/test/mocks/oidc";

export const config = testOidcConfig();
export const REDIRECT = "http://localhost:3000/api/auth/callback";

const jwtAccessToken = () => unsignedJwt({ sub: "user-1", aud: ["proj-1"] });

/** Starts a login and returns what the IdP would have seen, plus the cookie. */
export async function begin(
  idp: ReturnType<typeof createFakeIdp>,
  options: { next?: string | null; register?: boolean } = {},
) {
  const started = await startLogin({
    config,
    deps: { fetch: idp.fetch },
    ...options,
  });
  const url = new URL(started.location);
  return { started, url, params: url.searchParams };
}

export function callback(params: Record<string, string>) {
  return new URL(`${REDIRECT}?${new URLSearchParams(params)}`);
}

/** An IdP that issues tokens only for the verifier matching the challenge. */
export function idpFor(
  begun: Awaited<ReturnType<typeof begin>>,
  tokenOverrides: Record<string, unknown> = {},
  nonce: string | null = begun.params.get("nonce"),
) {
  return createFakeIdp({
    onToken: (body) => {
      const challenge = createHash("sha256")
        .update(body.get("code_verifier") ?? "")
        .digest("base64url");
      if (
        body.get("grant_type") !== "authorization_code" ||
        body.get("code") !== "the-code" ||
        challenge !== begun.params.get("code_challenge") ||
        body.get("redirect_uri") !== REDIRECT
      ) {
        return { status: 400, body: { error: "invalid_grant" } };
      }
      return {
        body: {
          access_token: jwtAccessToken(),
          refresh_token: "rt-1",
          token_type: "Bearer",
          expires_in: 900,
          id_token: idToken(nonce ? { nonce } : {}),
          ...tokenOverrides,
        },
      };
    },
  });
}

export async function run(
  begun: Awaited<ReturnType<typeof begin>>,
  idp: ReturnType<typeof createFakeIdp>,
  query: Record<string, string>,
  sealed: string | null = begun.started.sealed,
) {
  return await completeLogin({
    config,
    callbackUrl: callback(query),
    sealed: sealed ?? undefined,
    deps: { fetch: idp.fetch },
  });
}
